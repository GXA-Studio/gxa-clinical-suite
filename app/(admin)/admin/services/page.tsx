import { createClient }   from '@/lib/supabase/server'
import { ServicesClient }  from '@/components/admin/services-client'
import { getAdminProfile } from '@/lib/admin/profile'

export default async function ServicesPage() {
  const { clinicId } = await getAdminProfile()
  const supabase = await createClient()

  const { data: services } = await supabase
    .from('services')
    .select('*')
    .eq('clinic_id', clinicId)
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Servicios</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gestiona los servicios ofrecidos por la clínica. La duración define los huecos del calendario.
        </p>
      </div>
      <ServicesClient services={services ?? []} />
    </div>
  )
}
