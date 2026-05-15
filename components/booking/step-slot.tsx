'use client'
import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Loader2, CalendarX } from 'lucide-react'
import { es } from 'date-fns/locale'
import { Button }   from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { cn }       from '@/lib/utils'
import type { ServiceOption, DoctorOption, SlotWithDoctors } from './types'

function toDateParam(d: Date) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

function formatSlotTime(iso: string, timezone: string) {
  return new Date(iso).toLocaleTimeString('es-ES', {
    timeZone: timezone,
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false,
  })
}

function startOfDay(d = new Date()) {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  return copy
}

interface Props {
  service:  ServiceOption
  // null  → "Cualquier especialista": calls Mode B (all doctors' availability)
  // DoctorOption → specific doctor: calls Mode A (single doctor's availability)
  doctor:   DoctorOption | null
  timezone: string
  onSelect: (slot: SlotWithDoctors) => void
  onBack:   () => void
}

export function StepSlot({ service, doctor, timezone, onSelect, onBack }: Props) {
  const today = useMemo(startOfDay, [])

  const [activeDow,    setActiveDow]    = useState<number[]>([])
  const [dowLoading,   setDowLoading]   = useState(true)
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined)
  const [month,        setMonth]        = useState<Date>(() => startOfDay())
  const [slots,        setSlots]        = useState<SlotWithDoctors[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)

  useEffect(() => {
    setDowLoading(true)
    fetch(`/api/available-days?serviceId=${service.id}`)
      .then((r) => r.json())
      .then((body) => setActiveDow(body.activeDow ?? []))
      .catch(() => setActiveDow([]))
      .finally(() => setDowLoading(false))
  }, [service.id])

  useEffect(() => {
    if (!selectedDate) return
    let cancelled = false
    setSlotsLoading(true)
    setSlots([])
    setSelectedSlot(null)

    const dateParam = toDateParam(selectedDate)
    const url = doctor
      ? `/api/slots?serviceId=${service.id}&doctorId=${doctor.id}&date=${dateParam}`
      : `/api/slots?serviceId=${service.id}&date=${dateParam}`

    fetch(url)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return
        if (doctor) {
          // Mode A: { slots: string[] } — convert to SlotWithDoctors[]
          setSlots(
            (body.slots ?? []).map((start: string) => ({ start, doctors: [doctor] }))
          )
        } else {
          // Mode B: { slots: Array<{ start, doctors[] }> }
          setSlots(body.slots ?? [])
        }
      })
      .catch(() => { if (!cancelled) setSlots([]) })
      .finally(() => { if (!cancelled) setSlotsLoading(false) })

    return () => { cancelled = true }
  }, [selectedDate, service.id, doctor])

  // 15-min grace: recompute every time slots arrive so the cutoff is always fresh
  const cutoff = useMemo(
    () => new Date(Date.now() + 15 * 60 * 1000),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slots]
  )

  const visibleSlots = useMemo(
    () => slots.filter((s) => new Date(s.start) > cutoff),
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

  function handleConfirm() {
    if (!selectedSlot) return
    const slot = visibleSlots.find((s) => s.start === selectedSlot)
    if (slot) onSelect(slot)
  }

  return (
    <motion.div
      key="step-slot"
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -32 }}
      transition={{ duration: 0.22, ease: 'easeInOut' }}
      className="space-y-5"
    >
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0 -ml-1">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-xl font-bold text-slate-900">Elige fecha y hora</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {service.name}
            {doctor && <> · {doctor.name}</>}
          </p>
        </div>
      </div>

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

      {selectedDate && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-3"
        >
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
                {visibleSlots.map((slot) => (
                  <button
                    key={slot.start}
                    onClick={() => setSelectedSlot(selectedSlot === slot.start ? null : slot.start)}
                    className={cn(
                      'rounded-lg border py-2.5 text-sm font-medium transition-all',
                      selectedSlot === slot.start
                        ? 'bg-primary text-white border-primary shadow-sm scale-[1.03]'
                        : 'bg-white border-slate-200 text-slate-700 hover:border-primary/50 hover:text-primary'
                    )}
                  >
                    {formatSlotTime(slot.start, timezone)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {selectedSlot && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          <Button className="w-full" size="lg" onClick={handleConfirm}>
            Confirmar {formatSlotTime(selectedSlot, timezone)}
          </Button>
        </motion.div>
      )}
    </motion.div>
  )
}
