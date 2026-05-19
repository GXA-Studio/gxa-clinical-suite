'use client'
import { WeeklyGrid } from './weekly-grid'
import type { DoctorOption, ServiceOption, InsuranceOption, TimeOfDay } from './types'

interface Props {
  doctor:           DoctorOption
  service:          ServiceOption
  insuranceIds:     string[]
  allInsurances:    InsuranceOption[]
  slots:            Record<string, string[]>
  dates:            string[]
  timezone:         string
  timeOfDay:        TimeOfDay
  onSlotClick:      (slotStart: string, doctor: DoctorOption) => void
  onFindNext?:      () => void
  isSearchingNext?: boolean
  noNextAvailable?: boolean
}

function DoctorAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className="h-14 w-14 rounded-full object-cover border-2 border-slate-100 shrink-0"
      />
    )
  }
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-lg shrink-0 border-2 border-primary/20">
      {initials}
    </div>
  )
}

export function DoctorResultCard({
  doctor, service, insuranceIds, allInsurances,
  slots, dates, timezone, timeOfDay, onSlotClick,
  onFindNext, isSearchingNext, noNextAvailable,
}: Props) {
  const docInsurances = allInsurances.filter((ins) => insuranceIds.includes(ins.id))

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Cabecera del médico */}
      <div className="flex items-start gap-4 p-5 pb-4">
        <DoctorAvatar name={doctor.name} avatarUrl={doctor.avatar_url} />

        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-slate-900 text-base leading-tight">{doctor.name}</h3>
          {doctor.specialty && (
            <p className="text-sm text-slate-500 mt-0.5">{doctor.specialty}</p>
          )}
          <p className="text-xs text-primary/70 font-medium mt-0.5">{service.name}</p>

          {/* Mutuas aceptadas */}
          {docInsurances.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {docInsurances.map((ins) => (
                <span
                  key={ins.id}
                  className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600"
                >
                  {ins.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Precio */}
        {service.price != null && (
          <div className="text-right shrink-0">
            <p className="text-lg font-bold text-slate-900">{service.price} €</p>
            <p className="text-[10px] text-slate-400">consulta</p>
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 mx-5" />

      {/* Parrilla semanal */}
      <div className="p-4 pt-3">
        <WeeklyGrid
          slots={slots}
          dates={dates}
          timezone={timezone}
          timeOfDay={timeOfDay}
          onSlotClick={(iso) => onSlotClick(iso, doctor)}
          onFindNext={onFindNext}
          isSearchingNext={isSearchingNext}
          noNextAvailable={noNextAvailable}
        />
      </div>
    </div>
  )
}
