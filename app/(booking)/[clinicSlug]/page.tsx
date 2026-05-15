import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BookingWizard } from '@/components/booking/booking-wizard'
import { getBookingData } from '@/lib/cache'
import type { ClinicBookingData, DoctorOption } from '@/components/booking/types'

// Raw shape returned by the Supabase JOIN query
type RawDoctor = { id: string; name: string; specialty: string | null; is_active: boolean }
type RawService = {
  id: string
  name: string
  duration_minutes: number
  price: unknown
  description: unknown
  is_active: boolean
  doctor_services: { doctors: RawDoctor | null }[]
}

// Single JOIN query: clinic + services + doctors in one DB round-trip
async function fetchClinicBookingData(clinicSlug: string): Promise<ClinicBookingData | null> {
  const supabase = await createClient()

  const { data: raw } = await supabase
    .from('clinics')
    .select(`
      id, name, timezone,
      services(
        id, name, duration_minutes, price, description, is_active,
        doctor_services(
          doctors(id, name, specialty, is_active)
        )
      )
    `)
    .eq('slug', clinicSlug)
    .single()

  if (!raw) return null

  const services = ((raw.services as unknown as RawService[]) ?? [])
    .filter((svc) => svc.is_active)
    .map((svc) => ({
      id:               svc.id,
      name:             svc.name,
      duration_minutes: svc.duration_minutes,
      price:            svc.price as number | null,
      description:      svc.description as string | null,
      doctors: svc.doctor_services
        .map((ds) => ds.doctors)
        .filter((d): d is RawDoctor => !!d && d.is_active)
        .map((d): DoctorOption => ({ id: d.id, name: d.name, specialty: d.specialty })),
    }))
    .filter((s) => s.doctors.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name))

  return { id: raw.id, name: raw.name, timezone: raw.timezone, services }
}

export async function generateMetadata({ params }: { params: Promise<{ clinicSlug: string }> }) {
  const { clinicSlug } = await params
  const data = await getBookingData(clinicSlug, () => fetchClinicBookingData(clinicSlug))
  return { title: data?.name ? `Reservar cita — ${data.name}` : 'Reservar cita' }
}

export default async function BookingPage({ params }: { params: Promise<{ clinicSlug: string }> }) {
  const { clinicSlug } = await params
  const clinicData = await getBookingData(clinicSlug, () => fetchClinicBookingData(clinicSlug))
  if (!clinicData) notFound()
  return <BookingWizard clinic={clinicData} />
}
