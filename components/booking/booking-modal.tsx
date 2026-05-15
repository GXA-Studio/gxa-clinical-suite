'use client'
import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { StepPatient }   from './step-patient'
import { StepOtp }       from './step-otp'
import { StepConfirmed } from './step-confirmed'
import type { ServiceOption, DoctorOption, ModalPhase } from './types'

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
  clinicId:     string
  timezone:     string
  service:      ServiceOption
  doctor:       DoctorOption
  slotStart:    string
}

export function BookingModal({
  open, onOpenChange, clinicId, timezone, service, doctor, slotStart,
}: Props) {
  const [phase,         setPhase]         = useState<ModalPhase>('patient')
  const [patientName,   setPatientName]   = useState('')
  const [patientPhone,  setPatientPhone]  = useState('')
  const [appointmentId, setAppointmentId] = useState<string | null>(null)
  const [isLoading,     setIsLoading]     = useState(false)
  const [patientError,  setPatientError]  = useState<string | null>(null)
  const [otpError,      setOtpError]      = useState<string | null>(null)

  function resetState() {
    setPhase('patient')
    setPatientName('')
    setPatientPhone('')
    setAppointmentId(null)
    setIsLoading(false)
    setPatientError(null)
    setOtpError(null)
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) resetState()
    onOpenChange(nextOpen)
  }

  async function sendOtp(name: string, phone: string) {
    setIsLoading(true)
    setPatientError(null)
    try {
      const res = await fetch('/api/otp/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          clinicId,
          doctorId:     doctor.id,
          serviceId:    service.id,
          startsAt:     slotStart,
          patientName:  name,
          patientPhone: phone,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        if (res.status === 409) {
          setPatientError('Este horario ya no está disponible. Por favor elige otro.')
          handleOpenChange(false)
          return
        }
        if (res.status === 429) {
          setPatientError('Demasiados intentos. Espera unos minutos.')
          return
        }
        setPatientError(body.error ?? 'No se pudo enviar el SMS. Inténtalo de nuevo.')
        return
      }
      setPatientName(name)
      setPatientPhone(phone)
      setAppointmentId(body.appointmentId)
      setPhase('otp')
    } catch {
      setPatientError('Error de red. Revisa tu conexión.')
    } finally {
      setIsLoading(false)
    }
  }

  async function verifyOtp(code: string) {
    if (!appointmentId) return
    setIsLoading(true)
    setOtpError(null)
    try {
      const res = await fetch('/api/otp/verify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ appointmentId, otpCode: code }),
      })
      const body = await res.json()
      if (!res.ok) {
        if (res.status === 401) {
          setOtpError('Código incorrecto. Revísalo e inténtalo de nuevo.')
          return
        }
        if (res.status === 429) {
          setOtpError('Demasiados intentos. La cita ha sido cancelada por seguridad.')
          handleOpenChange(false)
          return
        }
        setOtpError(body.error ?? 'Error al verificar.')
        return
      }
      setPhase('confirmed')
    } catch {
      setOtpError('Error de red. Revisa tu conexión.')
    } finally {
      setIsLoading(false)
    }
  }

  async function resendOtp() {
    if (patientName && patientPhone) await sendOtp(patientName, patientPhone)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <AnimatePresence mode="wait">
          {phase === 'patient' && (
            <StepPatient
              key="patient"
              service={service}
              doctor={doctor}
              timezone={timezone}
              slotStart={slotStart}
              onSubmit={sendOtp}
              onBack={() => handleOpenChange(false)}
              isLoading={isLoading}
              error={patientError}
            />
          )}
          {phase === 'otp' && (
            <StepOtp
              key="otp"
              patientPhone={patientPhone}
              onVerify={verifyOtp}
              onResend={resendOtp}
              isLoading={isLoading}
              error={otpError}
            />
          )}
          {phase === 'confirmed' && (
            <StepConfirmed
              key="confirmed"
              service={service}
              doctor={doctor}
              slotStart={slotStart}
              timezone={timezone}
              patientName={patientName}
            />
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  )
}
