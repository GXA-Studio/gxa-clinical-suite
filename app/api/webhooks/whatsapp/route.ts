import { NextRequest } from 'next/server'
import { validateRequest } from 'twilio'
import twilio from 'twilio'
import { createServiceClient } from '@/lib/supabase/server'
import { sendCancellationWhatsApp } from '@/lib/twilio/client'

const CANCEL_KEYWORDS  = ['cancelar', 'anular', 'baja', 'cancel']
const MODIFY_KEYWORDS  = ['modificar', 'cambiar', 'reprogramar', 'mover', 'reschedule', 'cambio', 'reagendar']
const PRIVACY_KEYWORDS = ['rgpd', 'privacidad', 'datos', 'info', 'legal', 'informacion']

function stripWhatsappPrefix(from: string): string {
  return from.replace(/^whatsapp:/, '')
}

// Reconstruct the exact public URL Twilio signed.
// req.url in Next.js App Router on Vercel is the internal URL (http://...) —
// not what Twilio called. We must use the forwarded headers to get the real one.
function buildWebhookUrl(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host  = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  // Strip any accidental trailing slash from host and use only the path
  return `${proto}://${host}/api/webhooks/whatsapp`
}

// POST /api/webhooks/whatsapp
//
// Handles inbound WhatsApp messages from Twilio Sandbox.
// Configure this URL in Twilio console → Messaging → Sandbox → "When a message comes in".
//
// Security: HMAC-SHA1 signature validation via X-Twilio-Signature header.
export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN

  if (!authToken) {
    console.error('[webhooks/whatsapp] Missing TWILIO_AUTH_TOKEN')
    return new Response('Misconfigured', { status: 500 })
  }

  const signature  = req.headers.get('x-twilio-signature') ?? ''
  const webhookUrl = buildWebhookUrl(req)

  let params: Record<string, string> = {}
  try {
    const formData = await req.formData()
    formData.forEach((value, key) => { params[key] = String(value) })
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const isValid = validateRequest(authToken, signature, webhookUrl, params)
  if (!isValid) {
    console.error(
      '[webhooks/whatsapp] Invalid Twilio signature — rejected\n' +
      `  url_used:  ${webhookUrl}\n` +
      `  signature: ${signature.slice(0, 12)}...\n` +
      `  token_hint: ${authToken.slice(0, 4)}...`
    )
    return new Response('Forbidden', { status: 403 })
  }

  const fromRaw  = params['From'] ?? ''
  const bodyText = (params['Body'] ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
  const phone    = stripWhatsappPrefix(fromRaw)

  const twiml = new twilio.twiml.MessagingResponse()

  // x-forwarded-host is always injected by Vercel's edge and never resolves to localhost,
  // making it the most reliable source for building outbound links in inbound webhook handlers.
  const fwdProto  = req.headers.get('x-forwarded-proto') ?? 'https'
  const fwdHost   = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  const appBaseUrl = `${fwdProto}://${fwdHost}`

  const hasCancel  = CANCEL_KEYWORDS.some((kw) => bodyText.includes(kw))
  const hasModify  = !hasCancel && MODIFY_KEYWORDS.some((kw) => bodyText.includes(kw))
  const hasPrivacy = PRIVACY_KEYWORDS.some((kw) => bodyText.includes(kw))

  if (hasModify) {
    const supabase = createServiceClient()

    const { data: appt } = await supabase
      .from('appointments')
      .select('id, starts_at, cancellation_token')
      .eq('patient_phone', phone)
      .eq('status', 'confirmed')
      .gt('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (!appt) {
      twiml.message(
        'No encontramos ninguna cita próxima asociada a este número. ' +
        'Si crees que es un error, contacta directamente con tu clínica.'
      )
    } else {
      twiml.message(
        '📅 Para modificar la fecha u hora de tu cita, entra en tu enlace personal:\n\n' +
        `${appBaseUrl}/manage/${appt.cancellation_token}\n\n` +
        'Desde ahí podrás elegir un nuevo horario o cancelar si lo prefieres.'
      )
    }
  } else if (hasCancel) {
    const supabase = createServiceClient()

    // S-9 PATCH: select strictly the most imminent confirmed future
    // appointment for this phone (ASC + limit 1) and pull the clinic
    // context needed by sendCancellationWhatsApp so the patient gets a
    // formal outbound confirmation in addition to the inline TwiML reply.
    const { data: appt } = await supabase
      .from('appointments')
      .select('id, patient_name, patient_phone, starts_at, clinics(name, timezone)')
      .eq('patient_phone', phone)
      .eq('status', 'confirmed')
      .gt('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (!appt) {
      twiml.message(
        'No encontramos ninguna cita próxima asociada a este número. ' +
        'Si crees que es un error, contacta directamente con tu clínica.'
      )
    } else {
      // Defence-in-depth: include `status='confirmed'` in the UPDATE predicate
      // so two simultaneous "cancelar" messages can't double-cancel.
      const { error } = await supabase
        .from('appointments')
        .update({ status: 'cancelled' })
        .eq('id', appt.id)
        .eq('status', 'confirmed')

      if (error) {
        console.error('[webhooks/whatsapp] Cancel error:', error)
        twiml.message('Ha ocurrido un error al cancelar tu cita. Por favor, inténtalo de nuevo o contacta con la clínica.')
      } else {
        // S-9: fire the canonical outbound confirmation. Mirrors what the
        // /manage/[token] and admin cancel paths do, so all cancel flows
        // produce the same formal Twilio message with the formatted date.
        const clinic = (Array.isArray(appt.clinics) ? appt.clinics[0] : appt.clinics) as
          { name: string; timezone: string } | null
        try {
          await sendCancellationWhatsApp({
            to:          appt.patient_phone as string,
            patientName: appt.patient_name as string,
            clinicName:  clinic?.name ?? 'la clínica',
            startsAt:    appt.starts_at as string,
            timezone:    clinic?.timezone ?? 'Europe/Madrid',
          })
        } catch (err) {
          console.error('[webhooks/whatsapp] sendCancellationWhatsApp failed:', err)
        }
        twiml.message('✅ Cita anulada correctamente. El hueco ya está libre. ¡Hasta pronto!')
      }
    }
  } else if (hasPrivacy) {
    twiml.message(
      'Para ejercer tus derechos de acceso, rectificación, cancelación u oposición sobre tus datos personales, ' +
      'por favor envía un correo electrónico a studiogxa@gmail.com indicando tu número de teléfono.\n\n' +
      `Puedes leer nuestra política de privacidad completa en: ${appBaseUrl}/privacidad`
    )
  } else {
    twiml.message(
      '👋 Hola. ¿En qué puedo ayudarte?\n\n' +
      'Para *modificar tu cita* (cambiar fecha u hora) escribe "modificar".\n' +
      'Para *cancelar tu cita* escribe "cancelar".\n' +
      'Para información sobre privacidad y RGPD escribe "info".\n' +
      'También puedes gestionar tu cita usando el enlace que te enviamos al confirmar.\n\n' +
      'Para cualquier otra consulta, contacta directamente con tu clínica.'
    )
  }

  return new Response(twiml.toString(), {
    headers: { 'Content-Type': 'text/xml' },
  })
}
