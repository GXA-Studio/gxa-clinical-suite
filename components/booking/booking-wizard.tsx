'use client'
import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { StepService }   from './step-service'
import { StepDoctor }    from './step-doctor'
import { StepSlot }      from './step-slot'
import { StepPatient }   from './step-patient'
import { StepOtp }       from './step-otp'
import { StepConfirmed } from './step-confirmed'
import type { ClinicBookingData, ServiceOption, DoctorOption, BookingState } from './types'

const TOTAL_STEPS = 5  // service, doctor, slot, patient, otp (confirmed is terminal)

const STEP_LABELS = ['Servicio', 'Médico', 'Fecha', 'Datos', 'Código']

function ProgressBar({ current }: { current: number }) {
  const pct = Math.round((current / TOTAL_STEPS) * 100)
  return (
    <div className="space-y-2 mb-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5 items-center">
          {STEP_LABELS.map((label, i) => (
            <span
              key={i}
              className={`text-[11px] font-medium transition-colors ${
                i < current ? 'text-primary' : i === current ? 'text-slate-700' : 'text-slate-300'
              }`}
            >
              {label}
              {i < STEP_LABELS.length - 1 && (
                <span className="text-slate-200 mx-1">›</span>
              )}
            </span>
          ))}
        </div>
        <span className="text-[11px] text-slate-400 tabular-nums">{current + 1}/{TOTAL_STEPS}</span>
      </div>
      <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-primary"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
        />
      </div>
    </div>
  )
}

const STEPS = { SERVICE: 0, DOCTOR: 1, SLOT: 2, PATIENT: 3, OTP: 4, CONFIRMED: 5 }

export function BookingWizard({ clinic }: { clinic: ClinicBookingData }) {
  const [state, setState] = useState<BookingState>({
    step:          STEPS.SERVICE,
    service:       null,
    doctor:        null,
    slotStart:     null,
    patientName:   '',
    patientPhone:  '',
    appointmentId: null,
  })

  const [otpError,     setOtpError]     = useState<string | null>(null)
  const [patientError, setPatientError] = useState<string | null>(null)
  const [isLoading,    setIsLoading]    = useState(false)

  // ─── Step handlers ────────────────────────────────────────────

  function selectService(service: ServiceOption) {
    setState((s) => ({ ...s, step: STEPS.DOCTOR, service, doctor: null, slotStart: null }))
  }

  function selectDoctor(doctor: DoctorOption) {
    setState((s) => ({ ...s, step: STEPS.SLOT, doctor, slotStart: null }))
  }

  function selectSlot(slotStart: string) {
    setState((s) => ({ ...s, step: STEPS.PATIENT, slotStart }))
  }

  function goBack() {
    setState((s) => ({ ...s, step: Math.max(0, s.step - 1) }))
  }

  async function sendOtp(name: string, phone: string) {
    setIsLoading(true)
    setPatientError(null)
    try {
      const res = await fetch('/api/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinicId:    clinic.id,
          doctorId:    state.doctor!.id,
          serviceId:   state.service!.id,
          startsAt:    state.slotStart!,
          patientName: name,
          patientPhone: phone,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        if (res.status === 409) {
          setPatientError('Este horario ya no está disponible. Por favor elige otro.')
          setState((s) => ({ ...s, step: STEPS.SLOT }))
          return
        }
        if (res.status === 429) {
          setPatientError('Demasiados intentos. Espera unos minutos e inténtalo de nuevo.')
          return
        }
        setPatientError(body.error ?? 'No se pudo enviar el SMS. Inténtalo de nuevo.')
        return
      }
      setState((s) => ({
        ...s,
        step:          STEPS.OTP,
        patientName:   name,
        patientPhone:  phone,
        appointmentId: body.appointmentId,
      }))
    } catch {
      setPatientError('Error de red. Revisa tu conexión e inténtalo de nuevo.')
    } finally {
      setIsLoading(false)
    }
  }

  async function verifyOtp(code: string) {
    if (!state.appointmentId) return
    setIsLoading(true)
    setOtpError(null)
    try {
      const res = await fetch('/api/otp/verify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ appointmentId: state.appointmentId, otpCode: code }),
      })
      const body = await res.json()
      if (!res.ok) {
        if (res.status === 401) {
          setOtpError('Código incorrecto. Revísalo e inténtalo de nuevo.')
          return
        }
        if (res.status === 429) {
          setOtpError('Demasiados intentos. La cita ha sido cancelada por seguridad.')
          setState((s) => ({ ...s, step: STEPS.SERVICE }))
          return
        }
        setOtpError(body.error ?? 'Error al verificar. Inténtalo de nuevo.')
        return
      }
      setState((s) => ({ ...s, step: STEPS.CONFIRMED }))
    } catch {
      setOtpError('Error de red. Revisa tu conexión e inténtalo de nuevo.')
    } finally {
      setIsLoading(false)
    }
  }

  async function resendOtp() {
    if (!state.patientName || !state.patientPhone) return
    await sendOtp(state.patientName, state.patientPhone)
  }

  // ─── Find doctors for the selected service ────────────────────

  const serviceData = clinic.services.find((s) => s.id === state.service?.id)
  const doctors     = serviceData?.doctors ?? []

  // ─── Render ───────────────────────────────────────────────────

  const showProgress = state.step < STEPS.CONFIRMED

  return (
    <div className="w-full">
      {showProgress && <ProgressBar current={state.step} />}

      <AnimatePresence mode="wait">
        {state.step === STEPS.SERVICE && (
          <StepService
            key="service"
            services={clinic.services}
            onSelect={selectService}
          />
        )}

        {state.step === STEPS.DOCTOR && state.service && (
          <StepDoctor
            key="doctor"
            service={state.service}
            doctors={doctors}
            onSelect={selectDoctor}
            onBack={goBack}
          />
        )}

        {state.step === STEPS.SLOT && state.service && state.doctor && (
          <StepSlot
            key="slot"
            service={state.service}
            doctor={state.doctor}
            timezone={clinic.timezone}
            onSelect={selectSlot}
            onBack={goBack}
          />
        )}

        {state.step === STEPS.PATIENT && state.service && state.doctor && state.slotStart && (
          <StepPatient
            key="patient"
            service={state.service}
            doctor={state.doctor}
            timezone={clinic.timezone}
            slotStart={state.slotStart}
            onSubmit={sendOtp}
            onBack={goBack}
            isLoading={isLoading}
            error={patientError}
          />
        )}

        {state.step === STEPS.OTP && (
          <StepOtp
            key="otp"
            patientPhone={state.patientPhone}
            onVerify={verifyOtp}
            onResend={resendOtp}
            isLoading={isLoading}
            error={otpError}
          />
        )}

        {state.step === STEPS.CONFIRMED && state.service && state.doctor && state.slotStart && (
          <StepConfirmed
            key="confirmed"
            service={state.service}
            doctor={state.doctor}
            slotStart={state.slotStart}
            timezone={clinic.timezone}
            patientName={state.patientName}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
