import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BookingWizard } from '@/components/booking/booking-wizard'
import type { ClinicBookingData } from '@/components/booking/types'

export async function generateMetadata({ params }: { params: Promise<{ clinicSlug: string }> }) {
  const { clinicSlug } = await params
  const supabase = await createClient()
  const { data } = await supabase.from('clinics').select('name').eq('slug', clinicSlug).single()
  return { title: data?.name ? `Reservar cita — ${data.name}` : 'Reservar cita' }
}

export default async function BookingPage({ params }: { params: Promise<{ clinicSlug: string }> }) {
  const { clinicSlug } = await params
  const supabase = await createClient()

  const { data: clinic } = await supabase
    .from('clinics')
    .select('id, name, timezone')
    .eq('slug', clinicSlug)
    .single()

  if (!clinic) notFound()

  const { data: rawServices } = await supabase
    .from('services')
    .select('id, name, duration_minutes, price, description, doctor_services(doctors(id, name, specialty, is_active))')
    .eq('clinic_id', clinic.id)
    .eq('is_active', true)
    .order('name')

  // Flatten doctor_services → doctors[], keep only active doctors
  const services = (rawServices ?? []).map((svc) => ({
    id:               svc.id,
    name:             svc.name,
    duration_minutes: svc.duration_minutes,
    price:            svc.price as number | null,
    description:      svc.description as string | null,
    doctors: (svc.doctor_services as { doctors: { id: string; name: string; specialty: string | null; is_active: boolean } | null }[])
      .map((ds) => ds.doctors)
      .filter((d): d is { id: string; name: string; specialty: string | null; is_active: boolean } => !!d && d.is_active),
  })).filter((s) => s.doctors.length > 0) // only show services with at least one active doctor

  const clinicData: ClinicBookingData = {
    id:       clinic.id,
    name:     clinic.name,
    timezone: clinic.timezone,
    services,
  }

  return <BookingWizard clinic={clinicData} />
}
