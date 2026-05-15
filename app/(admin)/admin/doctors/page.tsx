import { createClient }  from '@/lib/supabase/server'
import { DoctorsClient } from '@/components/admin/doctors-client'
import { getAdminProfile } from '@/lib/admin/profile'

export default async function DoctorsPage() {
  const { clinicId } = await getAdminProfile()
  const supabase = await createClient()

  const [{ data: doctors }, { data: services }] = await Promise.all([
    supabase.from('doctors')
      .select('*, doctor_services(service_id)')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false }),
    supabase.from('services').select('id, name').eq('clinic_id', clinicId).eq('is_active', true),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Médicos</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gestiona los médicos y sus servicios asociados.
        </p>
      </div>
      <DoctorsClient doctors={doctors ?? []} services={services ?? []} />
    </div>
  )
}
