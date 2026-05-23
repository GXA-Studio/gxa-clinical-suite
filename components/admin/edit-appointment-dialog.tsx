'use client'
import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle, ArrowLeft, Calendar, Clock,
  Loader2, Palette, Phone, Stethoscope, Trash2, User, Pencil,
} from 'lucide-react'
import { format } from 'date-fns'
import { Button }   from '@/components/ui/button'
import { Input }    from '@/components/ui/input'
import { Label }    from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  APPOINTMENT_COLOR_KEYS, APPOINTMENT_COLORS, COLOR_LABELS, COLOR_HEX,
  type AppointmentColor,
} from '@/lib/constants/colors'
import {
  adminCancelAppointment, adminRescheduleAppointment, adminUpdateAppointmentColor,
} from '@/app/(admin)/admin/agenda/actions'
import { useGuestMode } from '@/components/admin/guest-mode-context'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Doctor {
  id: string
  name: string
  specialty: string | null
  doctor_services: { service_id: string }[]
}

interface Service {
  id: string
  name: string
  duration_minutes: number
  color?: string | null
}

export interface AppointmentForEdit {
  id: string
  doctor_id: string
  service_id: string
  patient_name: string
  patient_phone: string
  starts_at: string   // UTC ISO
  ends_at: string     // UTC ISO
  color?: string | null
  services: { name: string; duration_minutes: number; color?: string | null } | null
}

interface Props {
  appointment: AppointmentForEdit
  doctors: Doctor[]
  services: Service[]
  timezone: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type View = 'details' | 'confirm-cancel' | 'reschedule'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(utcIso: string, tz: string) {
  return new Date(utcIso).toLocaleTimeString('es-ES', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function fmtDate(utcIso: string, tz: string) {
  return new Date(utcIso).toLocaleDateString('es-ES', {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long',
  })
}

function localDateStr(utcIso: string, tz: string) {
  // YYYY-MM-DD in the clinic's timezone (no .toISOString())
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(utcIso))
}

function fmtSlotTime(isoUtc: string, tz: string) {
  return new Date(isoUtc).toLocaleTimeString('es-ES', {
    hour: '2-digit', minute: '2-digit', timeZone: tz,
  })
}

// ─── Component ────────────────────────────────────────────────────────────────
export function EditAppointmentDialog({
  appointment, doctors, services, timezone, open, onOpenChange,
}: Props) {
  const router = useRouter()
  const { notifyDemo } = useGuestMode()
  const [view, setView] = useState<View>('details')
  const [pending, start] = useTransition()

  // Reschedule form state
  const [newDoctorId,  setNewDoctorId]  = useState(appointment.doctor_id)
  const [newDate,      setNewDate]      = useState(() => localDateStr(appointment.starts_at, timezone))
  const [newSlotStart, setNewSlotStart] = useState('')
  const [slots,        setSlots]        = useState<string[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)

  const isPast = new Date(appointment.starts_at) < new Date()

  // Color state — resolved: appointment override → service color → 'blue'
  const resolvedColor = (appointment.color
    ?? services.find(s => s.id === appointment.service_id)?.color
    ?? 'blue') as AppointmentColor
  const [activeColor, setActiveColor] = useState<AppointmentColor>(resolvedColor)

  // Current doctor and service display
  const currentDoctor  = doctors.find(d => d.id === appointment.doctor_id)
  const currentService = appointment.services

  // Reschedule: services filtered by selected doctor
  const newDoctorServices = doctors.find(d => d.id === newDoctorId)?.doctor_services ?? []
  const newServiceIds     = new Set(newDoctorServices.map(ds => ds.service_id))

  // We keep the same service_id for the reschedule (RPC doesn't support changing it)
  // Fetch slots whenever doctor / date changes in reschedule view
  useEffect(() => {
    if (view !== 'reschedule' || !newDoctorId || !newDate) return
    setNewSlotStart('')
    setSlots([])
    setLoadingSlots(true)
    fetch(`/api/slots?doctorId=${newDoctorId}&serviceId=${appointment.service_id}&date=${newDate}`)
      .then(r => r.json())
      .then(body => setSlots(body.slots ?? []))
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false))
  }, [newDoctorId, newDate, view, appointment.service_id])

  function resetAndClose() {
    setView('details')
    setActiveColor(resolvedColor)
    setNewDoctorId(appointment.doctor_id)
    setNewDate(localDateStr(appointment.starts_at, timezone))
    setNewSlotStart('')
    setSlots([])
    onOpenChange(false)
  }

  // ── Color update ─────────────────────────────────────────────────────────────
  function handleColorChange(color: AppointmentColor) {
    const previous = activeColor
    setActiveColor(color)  // optimistic
    start(async () => {
      const result = await adminUpdateAppointmentColor(appointment.id, color)
      if (result.demo) {
        setActiveColor(previous)  // rollback: server didn't persist
        notifyDemo()
        return
      }
      if (result.error) {
        setActiveColor(previous)
        toast({ variant: 'destructive', title: 'Error al cambiar el color', description: result.error })
      }
    })
  }

  // ── Cancel ──────────────────────────────────────────────────────────────────
  function handleConfirmCancel() {
    start(async () => {
      const result = await adminCancelAppointment(appointment.id)
      if (result.demo) {
        notifyDemo()
        resetAndClose()
        return
      }
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error al cancelar', description: result.error })
        return
      }
      toast({ variant: 'success', title: 'Cita cancelada', description: 'Se envió WhatsApp de cancelación al paciente.' })
      router.refresh()
      resetAndClose()
    })
  }

  // ── Reschedule ──────────────────────────────────────────────────────────────
  function handleReschedule() {
    if (!newSlotStart) {
      toast({ variant: 'destructive', title: 'Selecciona una hora', description: 'Elige un horario disponible antes de guardar.' })
      return
    }
    start(async () => {
      const result = await adminRescheduleAppointment(appointment.id, newDoctorId, newSlotStart)
      if (result.demo) {
        notifyDemo()
        resetAndClose()
        return
      }
      if (result.error) {
        toast({ variant: 'destructive', title: 'Error al reprogramar', description: result.error })
        return
      }
      toast({ variant: 'success', title: 'Cita reprogramada', description: 'Se envió WhatsApp de confirmación al paciente.' })
      router.refresh()
      resetAndClose()
    })
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  const titleMap: Record<View, string> = {
    'details':        'Detalle de cita',
    'confirm-cancel': 'Confirmar cancelación',
    'reschedule':     'Reprogramar cita',
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) resetAndClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {(view === 'confirm-cancel' || view === 'reschedule') && (
              <button
                onClick={() => setView('details')}
                className="rounded p-0.5 hover:bg-slate-100"
                aria-label="Volver"
              >
                <ArrowLeft className="h-4 w-4 text-slate-500" />
              </button>
            )}
            {titleMap[view]}
          </DialogTitle>
        </DialogHeader>

        {/* ── DETAILS VIEW ─────────────────────────────────────────────────── */}
        {view === 'details' && (
          <>
            <div className="space-y-3 py-1">
              {/* Patient */}
              <InfoRow icon={User} label="Paciente">
                <span className="font-medium">{appointment.patient_name}</span>
              </InfoRow>
              <InfoRow icon={Phone} label="Teléfono">
                {appointment.patient_phone}
              </InfoRow>

              {/* Doctor */}
              <InfoRow icon={Stethoscope} label="Médico">
                {currentDoctor?.name ?? appointment.doctor_id}
                {currentDoctor?.specialty && (
                  <span className="ml-1 text-slate-400">· {currentDoctor.specialty}</span>
                )}
              </InfoRow>

              {/* Service */}
              {currentService && (
                <InfoRow icon={Stethoscope} label="Servicio">
                  {currentService.name}
                  <span className="ml-1 text-slate-400">· {currentService.duration_minutes} min</span>
                </InfoRow>
              )}

              {/* Date / time */}
              <InfoRow icon={Calendar} label="Fecha">
                <span className="capitalize">{fmtDate(appointment.starts_at, timezone)}</span>
              </InfoRow>
              <InfoRow icon={Clock} label="Horario">
                {fmtTime(appointment.starts_at, timezone)} – {fmtTime(appointment.ends_at, timezone)}
              </InfoRow>

              {/* Color picker — only for future appointments */}
              {!isPast && (
                <div className="flex items-start gap-2 pt-1">
                  <Palette className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <div className="min-w-0 text-sm">
                    <span className="text-slate-400">Color: </span>
                    <div className="mt-1.5 flex items-center gap-2.5">
                      {APPOINTMENT_COLOR_KEYS.map(c => (
                        <button
                          key={c}
                          type="button"
                          title={COLOR_LABELS[c]}
                          onClick={() => handleColorChange(c)}
                          disabled={pending}
                          style={{ backgroundColor: COLOR_HEX[c] }}
                          className={cn(
                            'h-6 w-6 rounded-full transition-all border border-black/5',
                            activeColor === c
                              ? 'ring-2 ring-offset-2 ring-slate-400 scale-110'
                              : 'opacity-70 hover:opacity-100'
                          )}
                          aria-label={COLOR_LABELS[c]}
                        />
                      ))}
                      <span className="text-xs text-slate-500">
                        {COLOR_LABELS[activeColor]}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Status chip */}
              {isPast && (
                <div className="mt-1 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-500">
                  Esta cita ya ha pasado. No se puede modificar.
                </div>
              )}
            </div>

            <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between gap-2">
              {!isPast && (
                <>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setView('confirm-cancel')}
                    disabled={pending}
                    className="gap-1.5"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Cancelar cita
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={resetAndClose} disabled={pending}>
                      Cerrar
                    </Button>
                    <Button size="sm" onClick={() => setView('reschedule')} disabled={pending} className="gap-1.5">
                      <Pencil className="h-3.5 w-3.5" />
                      Reprogramar
                    </Button>
                  </div>
                </>
              )}
              {isPast && (
                <Button variant="outline" size="sm" onClick={resetAndClose} className="w-full sm:w-auto">
                  Cerrar
                </Button>
              )}
            </DialogFooter>
          </>
        )}

        {/* ── CONFIRM CANCEL VIEW ──────────────────────────────────────────── */}
        {view === 'confirm-cancel' && (
          <>
            <div className="space-y-3 py-2">
              <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="text-sm text-slate-700">
                  <p className="font-medium">¿Cancelar la cita de <span className="text-slate-900">{appointment.patient_name}</span>?</p>
                  <p className="mt-1 text-slate-500">
                    Se enviará automáticamente un WhatsApp de cancelación al paciente.
                    Esta acción no se puede deshacer.
                  </p>
                </div>
              </div>
              <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <span className="capitalize">{fmtDate(appointment.starts_at, timezone)}</span>
                {' · '}
                {fmtTime(appointment.starts_at, timezone)}
                {currentDoctor && <> · {currentDoctor.name}</>}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setView('details')} disabled={pending}>
                Volver
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleConfirmCancel}
                disabled={pending}
                className="gap-1.5"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {pending ? 'Cancelando…' : 'Sí, cancelar'}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── RESCHEDULE VIEW ──────────────────────────────────────────────── */}
        {view === 'reschedule' && (
          <>
            <div className="space-y-4 py-1">
              {/* Current service (read-only — RPC keeps it) */}
              {currentService && (
                <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <span className="font-medium">Servicio:</span>{' '}
                  {currentService.name} · {currentService.duration_minutes} min
                  <span className="ml-2 text-slate-400">(se mantiene)</span>
                </div>
              )}

              {/* New Doctor */}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs font-medium">
                  <Stethoscope className="h-3.5 w-3.5 text-muted-foreground" /> Médico
                </Label>
                <Select value={newDoctorId} onValueChange={setNewDoctorId} disabled={pending}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona médico" />
                  </SelectTrigger>
                  <SelectContent>
                    {doctors
                      .filter(d => newServiceIds.has(appointment.service_id) || d.id === newDoctorId || d.doctor_services.some(ds => ds.service_id === appointment.service_id))
                      .map(d => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}{d.specialty ? ` · ${d.specialty}` : ''}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {/* New Date — using format(date, 'yyyy-MM-dd') invariant via input value */}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs font-medium">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" /> Nueva fecha
                </Label>
                <Input
                  type="date"
                  value={newDate}
                  min={format(new Date(), 'yyyy-MM-dd')}
                  onChange={e => setNewDate(e.target.value)}
                  disabled={pending}
                />
              </div>

              {/* Slot picker */}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs font-medium">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" /> Horario disponible
                </Label>
                {loadingSlots ? (
                  <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Cargando horarios…
                  </div>
                ) : slots.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">
                    No hay horarios disponibles para esta fecha.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {slots.map(iso => (
                      <button
                        key={iso}
                        type="button"
                        onClick={() => setNewSlotStart(iso)}
                        className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                          newSlotStart === iso
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-slate-200 bg-white hover:border-primary/50 hover:bg-slate-50'
                        }`}
                        disabled={pending}
                      >
                        {fmtSlotTime(iso, timezone)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Summary */}
              {newSlotStart && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  <span className="font-medium">{doctors.find(d => d.id === newDoctorId)?.name}</span>
                  {' · '}
                  <span className="capitalize">{new Date(newDate.replace(/-/g, '/')).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                  {' · '}
                  {fmtSlotTime(newSlotStart, timezone)}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setView('details')} disabled={pending}>
                Volver
              </Button>
              <Button
                size="sm"
                onClick={handleReschedule}
                disabled={pending || !newSlotStart}
                className="gap-1.5"
              >
                {pending
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Guardando…</>
                  : 'Guardar cambios'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Info row helper ──────────────────────────────────────────────────────────
function InfoRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
      <div className="min-w-0 text-sm">
        <span className="text-slate-400">{label}: </span>
        {children}
      </div>
    </div>
  )
}
