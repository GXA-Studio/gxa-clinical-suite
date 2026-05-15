import { createClient } from '@/lib/supabase/server'
import { AppointmentsTable } from '@/components/admin/appointments-table'
import { NewAppointmentDialog } from '@/components/admin/new-appointment-dialog'
import { getAdminProfile } from '@/lib/admin/profile'

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; date?: string }>
}) {
  const { status, date } = await searchParams
  // getAdminProfile() is React.cache()-memoized — re-uses the result from layout with zero extra roundtrip
  const { clinicId, timezone } = await getAdminProfile()
  const supabase = await createClient()

  let query = supabase
    .from('appointments')
    .select(`
      id, patient_name, patient_phone, starts_at, ends_at, status, created_at, notes,
      doctors(id, name, specialty),
      services(id, name, duration_minutes)
    `)
    .eq('clinic_id', clinicId)
    .order('starts_at', { ascending: false })
    .limit(200)

  if (status && status !== 'all') {
    query = query.eq('status', status as 'pending' | 'confirmed' | 'cancelled')
  }

  if (date) {
    const dayStart = new Date(date + 'T00:00:00.000Z').toISOString()
    const dayEnd   = new Date(date + 'T23:59:59.999Z').toISOString()
    query = query.gte('starts_at', dayStart).lte('starts_at', dayEnd)
  }

  const [{ data: appointments }, { data: doctors }, { data: services }] = await Promise.all([
    query,
    supabase
      .from('doctors')
      .select('id, name, specialty, doctor_services(service_id)')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('services')
      .select('id, name, duration_minutes')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('name'),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Citas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Historial y gestión de todas las citas de la clínica.
          </p>
        </div>
        <NewAppointmentDialog
          doctors={doctors ?? []}
          services={services ?? []}
        />
      </div>
      <AppointmentsTable appointments={appointments ?? []} timezone={timezone} />
    </div>
  )
}
