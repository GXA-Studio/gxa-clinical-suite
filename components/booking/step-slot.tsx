'use client'
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Loader2, CalendarX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ServiceOption, DoctorOption } from './types'

const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MONTH_NAMES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function buildDateRange(days = 14): Date[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    return d
  })
}

function toDateParam(d: Date) {
  return d.toISOString().slice(0, 10)
}

function formatSlotTime(iso: string, timezone: string) {
  return new Date(iso).toLocaleTimeString('es-MX', {
    timeZone: timezone,
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false,
  })
}

interface Props {
  service:    ServiceOption
  doctor:     DoctorOption
  timezone:   string
  onSelect:   (slotStart: string) => void
  onBack:     () => void
}

export function StepSlot({ service, doctor, timezone, onSelect, onBack }: Props) {
  const dates = buildDateRange(14)
  const [activeDate, setActiveDate] = useState<Date>(dates[0])
  const [slots,      setSlots]      = useState<string[]>([])
  const [loading,    setLoading]    = useState(false)
  const [selected,   setSelected]   = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setSlots([])
    setSelected(null)

    const url = `/api/slots?doctorId=${doctor.id}&serviceId=${service.id}&date=${toDateParam(activeDate)}`
    fetch(url)
      .then((r) => r.json())
      .then((body) => {
        if (!cancelled) setSlots(body.slots ?? [])
      })
      .catch(() => {
        if (!cancelled) setSlots([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [activeDate, doctor.id, service.id])

  function handleConfirm() {
    if (selected) onSelect(selected)
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
            {service.name} · <span className="text-slate-700">{doctor.name}</span>
          </p>
        </div>
      </div>

      {/* Date strip */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide snap-x snap-mandatory">
        {dates.map((d) => {
          const isActive = toDateParam(d) === toDateParam(activeDate)
          const isToday  = toDateParam(d) === toDateParam(new Date())
          return (
            <button
              key={toDateParam(d)}
              onClick={() => setActiveDate(d)}
              className={cn(
                'flex flex-col items-center rounded-xl px-3.5 py-2.5 min-w-[56px] shrink-0 snap-start transition-all',
                isActive
                  ? 'bg-primary text-white shadow-sm'
                  : 'bg-white border border-slate-200 text-slate-600 hover:border-primary/50'
              )}
            >
              <span className={cn('text-[10px] font-medium', isActive ? 'text-primary-foreground/70' : 'text-slate-400')}>
                {isToday ? 'Hoy' : DAY_NAMES[d.getDay()]}
              </span>
              <span className="text-base font-bold leading-tight">{d.getDate()}</span>
              <span className={cn('text-[10px]', isActive ? 'text-primary-foreground/70' : 'text-slate-400')}>
                {MONTH_NAMES[d.getMonth()]}
              </span>
            </button>
          )
        })}
      </div>

      {/* Slots grid */}
      <div className="min-h-[140px]">
        {loading ? (
          <div className="flex justify-center items-center h-32 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : slots.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-slate-400 gap-2">
            <CalendarX className="h-6 w-6 opacity-50" />
            <p className="text-sm">Sin huecos disponibles este día</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slots.map((slot) => (
              <button
                key={slot}
                onClick={() => setSelected(selected === slot ? null : slot)}
                className={cn(
                  'rounded-lg border py-2.5 text-sm font-medium transition-all',
                  selected === slot
                    ? 'bg-primary text-white border-primary shadow-sm scale-[1.03]'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-primary/50 hover:text-primary'
                )}
              >
                {formatSlotTime(slot, timezone)}
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          <Button className="w-full" size="lg" onClick={handleConfirm}>
            Confirmar {formatSlotTime(selected, timezone)}
          </Button>
        </motion.div>
      )}
    </motion.div>
  )
}
