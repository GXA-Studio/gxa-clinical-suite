'use client'
import { useState, useTransition, useEffect } from 'react'
import { Plus, Loader2, CalendarDays, User, Phone, Stethoscope, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { bookAppointmentManual } from '@/app/(admin)/admin/appointments/actions'

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
}

interface Props {
  doctors: Doctor[]
  services: Service[]
}

function formatTimeLabel(isoUtc: string, timezone: string) {
  return new Date(isoUtc).toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  })
}

function todayLocalDate() {
  return new Date().toISOString().slice(0, 10)
}

export function NewAppointmentDialog({ doctors, services }: Props) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()

  const [patientName,  setPatientName]  = useState('')
  const [patientPhone, setPatientPhone] = useState('')
  const [doctorId,  setDoctorId]  = useState('')
  const [serviceId, setServiceId] = useState('')
  const [date,      setDate]      = useState(todayLocalDate())
  const [slotStart, setSlotStart] = useState('')

  const [slots,        setSlots]        = useState<string[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)

  const doctorServices = doctors.find((d) => d.id === doctorId)?.doctor_services ?? []
  const serviceIds     = new Set(doctorServices.map((ds) => ds.service_id))
  const filteredServices = doctorId
    ? services.filter((s) => serviceIds.has(s.id))
    : services

  const selectedService = services.find((s) => s.id === serviceId)
  const selectedDoctor  = doctors.find((d) => d.id === doctorId)

  // Reset service and slot when doctor changes
  useEffect(() => {
    setServiceId('')
    setSlotStart('')
    setSlots([])
  }, [doctorId])

  // Reset slot when service or date changes
  useEffect(() => {
    setSlotStart('')
    setSlots([])
  }, [serviceId, date])

  // Fetch available slots when doctor + service + date are all set
  useEffect(() => {
    if (!doctorId || !serviceId || !date) return

    setLoadingSlots(true)
    fetch(`/api/slots?doctorId=${doctorId}&serviceId=${serviceId}&date=${date}`)
      .then((r) => r.json())
      .then((body) => {
        setSlots(body.slots ?? [])
      })
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false))
  }, [doctorId, serviceId, date])

  function resetForm() {
    setPatientName('')
    setPatientPhone('')
    setDoctorId('')
    setServiceId('')
    setDate(todayLocalDate())
    setSlotStart('')
    setSlots([])
  }

  function handleOpenChange(value: boolean) {
    setOpen(value)
    if (!value) resetForm()
  }

  function handleSubmit() {
    if (!patientName.trim() || !patientPhone || !doctorId || !serviceId || !slotStart) {
      toast({ variant: 'destructive', title: 'Campos incompletos', description: 'Rellena todos los campos antes de continuar.' })
      return
    }

    start(async () => {
      const result = await bookAppointmentManual({
        patientName:  patientName.trim(),
        patientPhone: patientPhone.trim(),
        doctorId,
        serviceId,
        startsAt: slotStart,
      })

      if (result.error) {
        toast({ variant: 'destructive', title: 'Error al crear cita', description: result.error })
        return
      }

      toast({ variant: 'success', title: 'Cita creada', description: 'El paciente recibirá un WhatsApp de confirmación.' })
      setOpen(false)
      resetForm()
    })
  }

  const canFetchSlots  = !!(doctorId && serviceId && date)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          Nueva cita
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Crear cita manualmente</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Patient info */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="na-name" className="flex items-center gap-1.5 text-xs font-medium">
                <User className="h-3.5 w-3.5 text-muted-foreground" /> Nombre del paciente
              </Label>
              <Input
                id="na-name"
                placeholder="Ana García López"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="na-phone" className="flex items-center gap-1.5 text-xs font-medium">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" /> Teléfono (WhatsApp)
              </Label>
              <Input
                id="na-phone"
                placeholder="+34612345678"
                value={patientPhone}
                onChange={(e) => setPatientPhone(e.target.value)}
                disabled={pending}
              />
            </div>
          </div>

          {/* Doctor + Service */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-medium">
                <Stethoscope className="h-3.5 w-3.5 text-muted-foreground" /> Médico
              </Label>
              <Select value={doctorId} onValueChange={setDoctorId} disabled={pending}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona médico" />
                </SelectTrigger>
                <SelectContent>
                  {doctors.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}{d.specialty ? ` · ${d.specialty}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Servicio</Label>
              <Select value={serviceId} onValueChange={setServiceId} disabled={!doctorId || pending}>
                <SelectTrigger>
                  <SelectValue placeholder={doctorId ? 'Selecciona servicio' : 'Elige médico primero'} />
                </SelectTrigger>
                <SelectContent>
                  {filteredServices.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} · {s.duration_minutes} min
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Date */}
          <div className="space-y-1.5">
            <Label htmlFor="na-date" className="flex items-center gap-1.5 text-xs font-medium">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" /> Fecha
            </Label>
            <Input
              id="na-date"
              type="date"
              value={date}
              min={todayLocalDate()}
              onChange={(e) => setDate(e.target.value)}
              disabled={pending}
            />
          </div>

          {/* Time slots */}
          {canFetchSlots && (
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
                  {slots.map((iso) => (
                    <button
                      key={iso}
                      type="button"
                      onClick={() => setSlotStart(iso)}
                      className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                        slotStart === iso
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-slate-200 bg-white hover:border-primary/50 hover:bg-slate-50'
                      }`}
                      disabled={pending}
                    >
                      {formatTimeLabel(iso, timezone)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Summary */}
          {slotStart && selectedDoctor && selectedService && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <span className="font-medium">{selectedDoctor.name}</span> · {selectedService.name} ·{' '}
              {new Date(slotStart).toLocaleString('es-ES', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: timezone,
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={pending || !patientName || !patientPhone || !slotStart}
          >
            {pending ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Creando…
              </>
            ) : (
              'Crear cita'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
