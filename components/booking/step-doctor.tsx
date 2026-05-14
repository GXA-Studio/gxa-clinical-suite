'use client'
import { motion } from 'framer-motion'
import { ChevronRight, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ServiceOption, DoctorOption } from './types'

interface Props {
  service:  ServiceOption
  doctors:  DoctorOption[]
  onSelect: (doctor: DoctorOption) => void
  onBack:   () => void
}

function initials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
}

export function StepDoctor({ service, doctors, onSelect, onBack }: Props) {
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
          <h2 className="text-xl font-bold text-slate-900">¿Con quién?</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Para <span className="font-medium text-slate-700">{service.name}</span>
          </p>
        </div>
      </div>

      <div className="space-y-2.5">
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
              <p className="font-semibold text-slate-900 group-hover:text-primary transition-colors">{doc.name}</p>
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
}
