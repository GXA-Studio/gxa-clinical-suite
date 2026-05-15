'use client'
import { memo } from 'react'
import { motion } from 'framer-motion'
import { ChevronRight, ArrowLeft, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ServiceOption, DoctorOption } from './types'

interface Props {
  service:   ServiceOption
  slotStart: string
  timezone:  string
  doctors:   DoctorOption[]
  onSelect:  (doctor: DoctorOption) => void
  onBack:    () => void
}

function initials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
}

function formatSlotShort(iso: string, timezone: string) {
  return new Date(iso).toLocaleString('es-ES', {
    timeZone: timezone,
    weekday:  'long',
    day:      'numeric',
    month:    'long',
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false,
  })
}

export const StepDoctor = memo(function StepDoctor({
  service,
  slotStart,
  timezone,
  doctors,
  onSelect,
  onBack,
}: Props) {
  return (
    <motion.div
      key="step-doctor"
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -32 }}
      transition={{ duration: 0.22, ease: 'easeInOut' }}
      className="space-y-4"
    >
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0 -ml-1">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-xl font-bold text-slate-900">Elige profesional</h2>
          <p className="text-sm text-slate-500 mt-0.5 capitalize">
            {service.name} · {formatSlotShort(slotStart, timezone)}
          </p>
        </div>
      </div>

      <div className="space-y-2.5">
        {/* "Any doctor" option — picks the first available */}
        <button
          onClick={() => onSelect(doctors[0])}
          className="w-full text-left rounded-xl border border-primary/30 bg-primary/5 p-4 hover:border-primary hover:shadow-sm active:scale-[0.99] transition-all group flex items-center gap-4"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 shrink-0">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-primary">Cualquier profesional disponible</p>
            <p className="text-xs text-slate-500 mt-0.5">Se asignará el primero disponible</p>
          </div>
          <ChevronRight className="h-4 w-4 text-primary/50 group-hover:text-primary shrink-0 transition-colors" />
        </button>

        {/* Individual doctors */}
        {doctors.map((doc) => (
          <button
            key={doc.id}
            onClick={() => onSelect(doc)}
            className="w-full text-left rounded-xl border border-slate-200 bg-white p-4 hover:border-primary hover:shadow-sm active:scale-[0.99] transition-all group flex items-center gap-4"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm shrink-0">
              {initials(doc.name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-900 group-hover:text-primary transition-colors">
                {doc.name}
              </p>
              {doc.specialty && (
                <p className="text-xs text-slate-500 mt-0.5">{doc.specialty}</p>
              )}
            </div>
            <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-primary shrink-0 transition-colors" />
          </button>
        ))}
      </div>
    </motion.div>
  )
})
