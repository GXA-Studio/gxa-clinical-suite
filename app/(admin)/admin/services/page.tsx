import { createClient }   from '@/lib/supabase/server'
import { ServicesClient }  from '@/components/admin/services-client'

export default async function ServicesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles').select('clinic_id').eq('id', user!.id).single()

  const { data: services } = await supabase
    .from('services')
    .select('*')
    .eq('clinic_id', profile?.clinic_id ?? '')
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
