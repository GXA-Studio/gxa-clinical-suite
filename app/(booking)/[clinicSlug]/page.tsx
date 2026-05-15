import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BookingSearch } from '@/components/booking/booking-search'
import { getBookingData } from '@/lib/cache'
import type { ClinicBookingData, DoctorOption, InsuranceOption } from '@/components/booking/types'

type RawDoctor = {
  id: string; name: string; specialty: string | null
  avatar_url: string | null; is_active: boolean
}
type RawService = {
  id: string; name: string; duration_minutes: number
  price: unknown; description: unknown; is_active: boolean
  doctor_services: { doctors: RawDoctor | null }[]
}

async function fetchClinicBookingData(clinicSlug: string): Promise<ClinicBookingData | null> {
  const supabase = await createClient()

  const [clinicRes, insurancesRes] = await Promise.all([
    supabase
      .from('clinics')
      .select(`
        id, name, timezone,
        services(
          id, name, duration_minutes, price, description, is_active,
          doctor_services(
            doctors(id, name, specialty, avatar_url, is_active)
          )
        )
      `)
      .eq('slug', clinicSlug)
      .single(),
    supabase.from('insurances').select('id, name, logo_url').order('name'),
  ])

  if (!clinicRes.data) return null
  const raw = clinicRes.data

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
        .map((d): DoctorOption => ({
          id:         d.id,
          name:       d.name,
          specialty:  d.specialty,
          avatar_url: d.avatar_url,
        })),
    }))
    .filter((s) => s.doctors.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name))

  // IDs únicos de médicos activos en todos los servicios
  const allDoctorIds = [...new Set(services.flatMap((s) => s.doctors.map((d) => d.id)))]

  const { data: diRows } = allDoctorIds.length > 0
    ? await supabase
        .from('doctor_insurances')
        .select('doctor_id, insurance_id')
        .in('doctor_id', allDoctorIds)
    : { data: [] }

  const doctorInsurances: Record<string, string[]> = {}
  for (const row of (diRows ?? [])) {
    if (!doctorInsurances[row.doctor_id]) doctorInsurances[row.doctor_id] = []
    doctorInsurances[row.doctor_id].push(row.insurance_id)
  }

  const insurances: InsuranceOption[] = (insurancesRes.data ?? []).map((i) => ({
    id:       i.id,
    name:     i.name,
    logo_url: i.logo_url ?? null,
  }))

  return { id: raw.id, name: raw.name, timezone: raw.timezone, services, insurances, doctorInsurances }
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
  return <BookingSearch clinic={clinicData} />
}
