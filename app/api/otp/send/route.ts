import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { sendOtpSms } from '@/lib/twilio/client'
import { generateOTP, hashOTP, isValidE164, sanitizeName } from '@/lib/utils'
import { otpSendLimiter } from '@/lib/rate-limit'

const SendOtpSchema = z.object({
  clinicId:  z.string().uuid(),
  doctorId:  z.string().uuid(),
  serviceId: z.string().uuid(),
  // M-04 FIX: strip control chars + newlines at the Zod layer to prevent SMS injection
  patientName: z
    .string()
    .min(2)
    .max(100)
    .trim()
    .transform(sanitizeName),
  patientPhone: z.string().refine(isValidE164, {
    message: 'Phone must be E.164 format, e.g. +521554001234',
  }),
  startsAt: z.string().datetime({ offset: true }),
})

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = SendOtpSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    )
  }

  const { clinicId, doctorId, serviceId, patientName, patientPhone, startsAt } = parsed.data

  if (new Date(startsAt) < new Date()) {
    return NextResponse.json({ error: 'Cannot book a slot in the past' }, { status: 422 })
  }

  // C-01 FIX: Rate limit by E.164 phone number — 3 OTP requests per 10 minutes
  const { success: ratePassed, reset } = await otpSendLimiter.limit(patientPhone)
  if (!ratePassed) {
    const retryAfterSec = Math.ceil((reset - Date.now()) / 1000)
    return NextResponse.json(
      {
        error: 'RATE_LIMITED',
        message: 'Too many OTP requests. Please wait before requesting another code.',
        retryAfter: retryAfterSec,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfterSec),
          'X-RateLimit-Limit': '3',
        },
      }
    )
  }

  const supabase = createServiceClient()

  const { data: clinic } = await supabase
    .from('clinics')
    .select('id, name')
    .eq('id', clinicId)
    .single()

  if (!clinic) {
    return NextResponse.json({ error: 'Clinic not found' }, { status: 404 })
  }

  const otp     = generateOTP()
  const otpHash = hashOTP(otp)

  const { data: appointment, error: bookError } = await supabase.rpc('book_slot', {
    p_clinic_id:     clinicId,
    p_doctor_id:     doctorId,
    p_service_id:    serviceId,
    p_patient_name:  patientName,
    p_patient_phone: patientPhone,
    p_starts_at:     startsAt,
    p_otp_code_hash: otpHash,
  })

  if (bookError) {
    if (bookError.code === 'P0001') {
      return NextResponse.json(
        { error: 'SLOT_TAKEN', message: 'This slot is no longer available. Please choose another.' },
        { status: 409 }
      )
    }
    console.error('[POST /api/otp/send] book_slot error:', bookError)
    return NextResponse.json({ error: 'Booking failed. Please try again.' }, { status: 500 })
  }

  const appt = Array.isArray(appointment) ? appointment[0] : appointment

  try {
    await sendOtpSms({ to: patientPhone, otp, clinicName: clinic.name })
  } catch (smsError) {
    console.error('[POST /api/otp/send] Twilio error:', smsError)

    // M-03 FIX: log cancel UPDATE failures — never discard errors silently
    const { error: cancelError } = await supabase
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('id', appt.id)

    if (cancelError) {
      // CRITICAL: slot rollback failed — appointment remains PENDING, blocking slot for ~5min until OTP expires
      console.error(
        '[POST /api/otp/send] CRITICAL: slot rollback failed after Twilio error.',
        'Appointment ID:', appt.id,
        'Will self-release when OTP expires (~5 min).',
        cancelError
      )
    }

    return NextResponse.json(
      { error: 'SMS delivery failed. Please check your phone number and try again.' },
      { status: 502 }
    )
  }

  return NextResponse.json({ appointmentId: appt.id }, { status: 201 })
}
