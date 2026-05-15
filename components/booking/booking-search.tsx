'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Loader2, SearchX } from 'lucide-react'
import { SearchBar }        from './search-bar'
import { DoctorResultCard } from './doctor-result-card'
import { BookingModal }     from './booking-modal'
import type {
  ClinicBookingData,
  DoctorOption,
  SearchFilters,
  WeekSlotsMap,
  ModalBookingState,
} from './types'

function todayString(): string {
  return new Date().toISOString().slice(0, 10)
}

export function BookingSearch({ clinic }: { clinic: ClinicBookingData }) {
  const services   = clinic.services
  const insurances = clinic.insurances ?? []
  const doctorIns  = clinic.doctorInsurances ?? {}

  const [filters, setFilters] = useState<SearchFilters>({
    serviceId:   services[0]?.id ?? '',
    doctorId:    null,
    date:        todayString(),
    timeOfDay:   'all',
    insuranceId: null,
  })

  const [weekSlots,    setWeekSlots]    = useState<WeekSlotsMap>({})
  const [dates,        setDates]        = useState<string[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)

  const [modal, setModal] = useState<ModalBookingState>({
    open:          false,
    phase:         'patient',
    service:       null,
    doctor:        null,
    slotStart:     null,
    patientName:   '',
    patientPhone:  '',
    appointmentId: null,
  })

  // Refetch cuando cambia servicio, médico concreto o fecha
  useEffect(() => {
    if (!filters.serviceId) return
    let cancelled = false
    setSlotsLoading(true)
    setWeekSlots({})
    setDates([])

    const params = new URLSearchParams({
      serviceId: filters.serviceId,
      startDate: filters.date,
    })
    if (filters.doctorId) params.set('doctorId', filters.doctorId)

    fetch(`/api/slots/week?${params}`)
      .then((r) => r.json())
      .then(({ dates: d, slots: s }) => {
        if (!cancelled) {
          setDates(d ?? [])
          setWeekSlots(s ?? {})
        }
      })
      .catch(() => {
        if (!cancelled) { setDates([]); setWeekSlots({}) }
      })
      .finally(() => { if (!cancelled) setSlotsLoading(false) })

    return () => { cancelled = true }
  }, [filters.serviceId, filters.doctorId, filters.date])

  const handleFilterChange = useCallback((next: Partial<SearchFilters>) => {
    setFilters((prev) => ({ ...prev, ...next }))
  }, [])

  const selectedService = useMemo(
    () => services.find((s) => s.id === filters.serviceId) ?? services[0],
    [services, filters.serviceId]
  )

  // Médicos a mostrar: filtra por mutua y médico concreto, ordena por slot más próximo
  const doctorsToDisplay = useMemo(() => {
    if (!selectedService) return []
    let docs = selectedService.doctors

    if (filters.insuranceId) {
      docs = docs.filter((d) => (doctorIns[d.id] ?? []).includes(filters.insuranceId!))
    }
    if (filters.doctorId) {
      docs = docs.filter((d) => d.id === filters.doctorId)
    }

    return [...docs].sort((a, b) => {
      const aFirst = Object.values(weekSlots[a.id] ?? {}).flat().sort()[0] ?? '9999'
      const bFirst = Object.values(weekSlots[b.id] ?? {}).flat().sort()[0] ?? '9999'
      return aFirst.localeCompare(bFirst)
    })
  }, [selectedService, filters.doctorId, filters.insuranceId, doctorIns, weekSlots])

  function handleSlotClick(slotStart: string, doctor: DoctorOption) {
    if (!selectedService) return
    setModal({
      open:          true,
      phase:         'patient',
      service:       selectedService,
      doctor,
      slotStart,
      patientName:   '',
      patientPhone:  '',
      appointmentId: null,
    })
  }

  return (
    <div>
      <SearchBar
        services={services}
        insurances={insurances}
        filters={filters}
        onChange={handleFilterChange}
      />

      {slotsLoading ? (
        <div className="flex items-center justify-center py-20 text-slate-400 gap-3">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Buscando disponibilidad…</span>
        </div>
      ) : (
        <div className="space-y-4">
          {doctorsToDisplay.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white p-12 text-center">
              <SearchX className="h-8 w-8 text-slate-300" />
              <div>
                <p className="text-sm font-medium text-slate-600">
                  No hay médicos disponibles con estos filtros
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Prueba a cambiar la mutua, el profesional o la fecha
                </p>
              </div>
            </div>
          ) : (
            doctorsToDisplay.map((doctor) => (
              <DoctorResultCard
                key={doctor.id}
                doctor={doctor}
                service={selectedService!}
                insuranceIds={doctorIns[doctor.id] ?? []}
                allInsurances={insurances}
                slots={weekSlots[doctor.id] ?? {}}
                dates={dates}
                timezone={clinic.timezone}
                timeOfDay={filters.timeOfDay}
                onSlotClick={handleSlotClick}
              />
            ))
          )}
        </div>
      )}

      {/* Modal de reserva: se abre al clicar un slot */}
      {modal.open && modal.service && modal.doctor && modal.slotStart && (
        <BookingModal
          open={modal.open}
          onOpenChange={(open) => setModal((prev) => ({ ...prev, open }))}
          clinicId={clinic.id}
          timezone={clinic.timezone}
          service={modal.service}
          doctor={modal.doctor}
          slotStart={modal.slotStart}
        />
      )}
    </div>
  )
}
