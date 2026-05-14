'use client'
import { motion } from 'framer-motion'
import { Clock, DollarSign, ChevronRight } from 'lucide-react'
import type { ServiceOption, ClinicBookingData } from './types'

interface Props {
  services: ClinicBookingData['services']
  onSelect: (service: ServiceOption) => void
}

export function StepService({ services, onSelect }: Props) {
  return (
    <motion.div
      key="step-service"
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -32 }}
      transition={{ duration: 0.22, ease: 'easeInOut' }}
      className="space-y-4"
    >
      <div>
        <h2 className="text-xl font-bold text-slate-900">¿Qué servicio necesitas?</h2>
        <p className="text-sm text-slate-500 mt-1">Selecciona el tipo de consulta o procedimiento.</p>
      </div>

      <div className="space-y-2.5">
        {services.map((svc) => (
          <button
            key={svc.id}
            onClick={() => onSelect(svc)}
            className="w-full text-left rounded-xl border border-slate-200 bg-white p-4 hover:border-primary hover:shadow-sm active:scale-[0.99] transition-all group"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-900 group-hover:text-primary transition-colors">{svc.name}</p>
                {svc.description && (
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{svc.description}</p>
                )}
                <div className="flex items-center gap-3 mt-2">
                  <span className="flex items-center gap-1 text-xs text-slate-400">
                    <Clock className="h-3 w-3" /> {svc.duration_minutes} min
                  </span>
                  {svc.price ? (
                    <span className="flex items-center gap-0.5 text-xs text-slate-400">
                      <DollarSign className="h-3 w-3" />{Number(svc.price).toFixed(2)}
                    </span>
                  ) : null}
                  <span className="text-xs text-slate-400">
                    {svc.doctors.length} {svc.doctors.length === 1 ? 'médico' : 'médicos'}
                  </span>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-primary shrink-0 mt-0.5 transition-colors" />
            </div>
          </button>
        ))}
      </div>
    </motion.div>
  )
}
