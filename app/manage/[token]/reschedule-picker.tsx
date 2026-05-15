'use client'
import { useState, useEffect, useMemo } from 'react'
import { ArrowLeft, CalendarX, Loader2 } from 'lucide-react'
import { es } from 'date-fns/locale'
import { Button }   from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { cn }       from '@/lib/utils'

interface Props {
  serviceId: string  // raw column from appointment, guaranteed non-undefined
  doctorId:  string  // raw column from appointment, guaranteed non-undefined
  timezone:  string
  onSelect:  (slotStart: string) => void
  onBack:    () => void
}

function toDateParam(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

function formatSlotTime(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('es-ES', {
    timeZone: timezone,
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false,
  })
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export function ReschedulePicker({ serviceId, doctorId, timezone, onSelect, onBack }: Props) {
  const today = useMemo(startOfToday, [])

  const [activeDow,    setActiveDow]    = useState<number[]>([])
  const [dowLoading,   setDowLoading]   = useState(true)
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined)
  const [month,        setMonth]        = useState<Date>(() => startOfToday())
  const [slots,        setSlots]        = useState<string[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)

  // Load active days-of-week for this service
  useEffect(() => {
    setDowLoading(true)
    fetch(`/api/available-days?serviceId=${serviceId}`)
      .then((r) => r.json())
      .then((body) => setActiveDow(body.activeDow ?? []))
      .catch(() => setActiveDow([]))
      .finally(() => setDowLoading(false))
  }, [serviceId])

  // Load available slots when a date is selected (Mode A: doctor-first)
  // Using doctor_id ensures we see THIS doctor's real-time availability,
  // not a merged view of all doctors. Avoids any ambiguity from service-first mode.
  useEffect(() => {
    if (!selectedDate) return
    let cancelled = false
    setSlotsLoading(true)
    setSlots([])
    setSelectedSlot(null)

    const dateParam = toDateParam(selectedDate)
    fetch(`/api/slots?doctorId=${doctorId}&serviceId=${serviceId}&date=${dateParam}`)
      .then((r) => r.json())
      .then((body: { slots?: string[] }) => {
        if (!cancelled) setSlots(body.slots ?? [])
      })
      .catch(() => { if (!cancelled) setSlots([]) })
      .finally(() => { if (!cancelled) setSlotsLoading(false) })

    return () => { cancelled = true }
  }, [selectedDate, doctorId, serviceId])

  // 15-min grace window — recomputed when slots update so it's always fresh
  const cutoff = useMemo(
    () => new Date(Date.now() + 15 * 60 * 1000),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slots]
  )

  const visibleSlots = useMemo(
    () => slots.filter((iso) => new Date(iso) > cutoff),
    [slots, cutoff]
  )

  const disabledMatcher = useMemo(
    () => (date: Date) => {
      if (date < today) return true
      if (activeDow.length === 0) return false
      return !activeDow.includes(date.getDay())
    },
    [activeDow, today]
  )

  const maxDate = useMemo(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 3)
    return d
  }, [])

  return (
    <div className="space-y-5">
      {/* Sub-header with back button */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0 -ml-1">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-xl font-bold text-slate-900">Elige nueva fecha</h2>
          <p className="text-sm text-slate-500 mt-0.5">Mismo médico, nuevo horario</p>
        </div>
      </div>

      {/* Calendar */}
      <div className="flex justify-center">
        {dowLoading ? (
          <div className="flex items-center justify-center h-[280px] w-full text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <Calendar
            mode="single"
            locale={es}
            selected={selectedDate}
            onSelect={(d) => { setSelectedDate(d); setSelectedSlot(null) }}
            month={month}
            onMonthChange={setMonth}
            disabled={disabledMatcher}
            toDate={maxDate}
            className="rounded-xl border border-slate-200 bg-white shadow-sm"
          />
        )}
      </div>

      {/* Slot list */}
      {selectedDate && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-700">
            Horas disponibles —{' '}
            <span className="capitalize">
              {selectedDate.toLocaleDateString('es-ES', {
                weekday: 'long',
                day:     'numeric',
                month:   'long',
              })}
            </span>
          </p>

          <div className="min-h-[100px]">
            {slotsLoading ? (
              <div className="flex justify-center items-center h-24 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : visibleSlots.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-24 text-slate-400 gap-2">
                <CalendarX className="h-5 w-5 opacity-50" />
                <p className="text-sm">Sin huecos disponibles este día</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {visibleSlots.map((iso) => (
                  <button
                    key={iso}
                    onClick={() => setSelectedSlot(selectedSlot === iso ? null : iso)}
                    className={cn(
                      'rounded-lg border py-2.5 text-sm font-medium transition-all',
                      selectedSlot === iso
                        ? 'bg-primary text-white border-primary shadow-sm scale-[1.03]'
                        : 'bg-white border-slate-200 text-slate-700 hover:border-primary/50 hover:text-primary'
                    )}
                  >
                    {formatSlotTime(iso, timezone)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirm slot selection */}
      {selectedSlot && (
        <Button className="w-full" size="lg" onClick={() => onSelect(selectedSlot)}>
          Confirmar {formatSlotTime(selectedSlot, timezone)}
        </Button>
      )}
    </div>
  )
}
