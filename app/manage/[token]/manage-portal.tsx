'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CalendarDays, User, Clock, XCircle,
  Pencil, CheckCircle2, AlertCircle, Loader2, ArrowLeft,
} from 'lucide-react'
import { Button }            from '@/components/ui/button'
import { ReschedulePicker }  from './reschedule-picker'
import { formatLocalDateTime } from '@/lib/utils'
import { cancelByToken, rescheduleAppointment } from './actions'
import type { ServiceOption } from '@/components/booking/types'

type View = 'details' | 'reschedule' | 'confirm-reschedule' | 'cancelled' | 'rescheduled'

interface Props {
  token: string
  appointment: {
    startsAt:    string
    status:      string
    patientName: string
  }
  clinic:    { id: string; name: string; timezone: string } | null
  doctor:    { id: string; name: string; specialty: string | null } | null
  service:   ServiceOption | null
  // Raw FK columns from the appointment row — always present, never rely on join shape
  doctorId:  string
  serviceId: string
  isActive:  boolean
  isPast:    boolean
}

export function ManagePortal({
  token, appointment, clinic, doctor, service,
  doctorId, serviceId,
  isActive, isPast,
}: Props) {
  const [view,        setView]        = useState<View>('details')
  const [loading,     setLoading]     = useState(false)
  const [errorMsg,    setErrorMsg]    = useState('')
  // Stores the ISO string of the chosen new slot (not a SlotWithDoctors object)
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [newStartsAt,  setNewStartsAt]  = useState<string | null>(null)

  const timezone = clinic?.timezone ?? 'Europe/Madrid'
  const dateStr  = formatLocalDateTime(appointment.startsAt, timezone)

  // ── Cancel ──────────────────────────────────────────────────────
  async function handleCancel() {
    setLoading(true)
    setErrorMsg('')
    const result = await cancelByToken(token)
    setLoading(false)
    if (result.success) {
      setView('cancelled')
    } else {
      setErrorMsg(result.error ?? 'Error desconocido.')
    }
  }

  // ── Reschedule ──────────────────────────────────────────────────
  function handleSlotSelected(slotStart: string) {
    setSelectedSlot(slotStart)
    setErrorMsg('')
    setView('confirm-reschedule')
  }

  async function handleConfirmReschedule() {
    if (!selectedSlot) return
    setLoading(true)
    setErrorMsg('')
    // Keep the same doctor — rescheduling means new time, same specialist
    const result = await rescheduleAppointment(token, doctorId, selectedSlot)
    setLoading(false)
    if (result.success) {
      setNewStartsAt(result.newStartsAt ?? selectedSlot)
      setView('rescheduled')
    } else {
      setErrorMsg(result.error ?? 'Error al reprogramar.')
    }
  }

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="w-full max-w-lg bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">

      {/* Header */}
      <div className="bg-primary/5 border-b border-primary/20 px-6 py-5">
        <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">
          {clinic?.name ?? 'Clínica'}
        </p>
        <h1 className="text-xl font-bold text-slate-900">
          {view === 'reschedule'         ? 'Selecciona nueva fecha' :
           view === 'confirm-reschedule' ? 'Confirmar cambio'       :
           view === 'cancelled'          ? 'Cita cancelada'         :
           view === 'rescheduled'        ? 'Cita modificada'        :
                                          'Gestionar tu cita'}
        </h1>
      </div>

      <AnimatePresence mode="wait">

        {/* ── DETAILS ── */}
        {view === 'details' && (
          <motion.div
            key="details"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="px-6 py-5 space-y-4">
              <div className="flex items-start gap-3">
                <CalendarDays className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">Fecha y hora</p>
                  <p className="text-sm font-semibold text-slate-800 capitalize">{dateStr}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <User className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">Especialista</p>
                  <p className="text-sm font-semibold text-slate-800">{doctor?.name ?? '—'}</p>
                  {doctor?.specialty && <p className="text-xs text-slate-500">{doctor.specialty}</p>}
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Clock className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">Servicio</p>
                  <p className="text-sm font-semibold text-slate-800">{service?.name ?? '—'}</p>
                  {service && <p className="text-xs text-slate-500">{service.duration_minutes} min</p>}
                </div>
              </div>
            </div>

            <div className="px-6 pb-6">
              {isActive ? (
                <>
                  <p className="text-xs text-slate-500 mb-4">
                    Paciente: <span className="font-medium text-slate-700">{appointment.patientName}</span>
                  </p>
                  {errorMsg && (
                    <div className="flex items-center gap-2 text-destructive mb-3">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <p className="text-sm">{errorMsg}</p>
                    </div>
                  )}
                  <div className="flex flex-col gap-3">
                    <Button
                      size="lg"
                      className="w-full"
                      onClick={() => { setErrorMsg(''); setView('reschedule') }}
                      disabled={loading}
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Modificar fecha u hora
                    </Button>
                    <Button
                      variant="destructive"
                      size="lg"
                      className="w-full"
                      onClick={handleCancel}
                      disabled={loading}
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Cancelar cita'}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <XCircle className="h-5 w-5 text-slate-400 shrink-0" />
                  <p className="text-sm text-slate-600">
                    {appointment.status === 'cancelled'
                      ? 'Esta cita ya fue cancelada anteriormente.'
                      : 'Esta cita ya ha pasado y no puede modificarse.'}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ── RESCHEDULE (slot picker) ── */}
        {view === 'reschedule' && (
          <motion.div
            key="reschedule"
            initial={{ opacity: 0, x: 32 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -32 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            className="px-6 py-5"
          >
            <ReschedulePicker
              serviceId={serviceId}
              doctorId={doctorId}
              timezone={timezone}
              onSelect={handleSlotSelected}
              onBack={() => { setErrorMsg(''); setView('details') }}
            />
          </motion.div>
        )}

        {/* ── CONFIRM RESCHEDULE ── */}
        {view === 'confirm-reschedule' && selectedSlot && (
          <motion.div
            key="confirm-reschedule"
            initial={{ opacity: 0, x: 32 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -32 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            className="px-6 py-5 space-y-5"
          >
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
              <p className="text-xs font-semibold text-primary uppercase tracking-widest">Nueva cita</p>
              <div className="flex items-start gap-3">
                <CalendarDays className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">Fecha y hora</p>
                  <p className="text-sm font-semibold text-slate-800 capitalize">
                    {formatLocalDateTime(selectedSlot, timezone)}
                  </p>
                </div>
              </div>
              {doctor && (
                <div className="flex items-start gap-3">
                  <User className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">Especialista</p>
                    <p className="text-sm font-semibold text-slate-800">{doctor.name}</p>
                  </div>
                </div>
              )}
            </div>

            {errorMsg && (
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <p className="text-sm">{errorMsg}</p>
              </div>
            )}

            <div className="flex flex-col gap-3">
              <Button
                size="lg"
                className="w-full"
                onClick={handleConfirmReschedule}
                disabled={loading}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {loading ? 'Guardando...' : 'Confirmar cambio'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => { setErrorMsg(''); setView('reschedule') }}
                disabled={loading}
              >
                <ArrowLeft className="h-4 w-4 mr-1" /> Volver a elegir
              </Button>
            </div>
          </motion.div>
        )}

        {/* ── CANCELLED success ── */}
        {view === 'cancelled' && (
          <motion.div
            key="cancelled"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25 }}
            className="px-6 py-10 flex flex-col items-center gap-4 text-center"
          >
            <CheckCircle2 className="h-14 w-14 text-emerald-500" />
            <div>
              <p className="text-lg font-bold text-slate-900">Cita cancelada</p>
              <p className="text-sm text-slate-500 mt-1">El hueco ha quedado libre. ¡Hasta pronto!</p>
            </div>
          </motion.div>
        )}

        {/* ── RESCHEDULED success ── */}
        {view === 'rescheduled' && (
          <motion.div
            key="rescheduled"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25 }}
            className="px-6 py-10 flex flex-col items-center gap-4 text-center"
          >
            <CheckCircle2 className="h-14 w-14 text-emerald-500" />
            <div>
              <p className="text-lg font-bold text-slate-900">¡Cita modificada!</p>
              {newStartsAt && (
                <p className="text-sm font-medium text-primary mt-1 capitalize">
                  {formatLocalDateTime(newStartsAt, timezone)}
                </p>
              )}
              <p className="text-sm text-slate-500 mt-1">
                Recibirás la confirmación en tu WhatsApp en breve.
              </p>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  )
}
