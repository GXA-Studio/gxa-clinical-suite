import { createClient } from '@/lib/supabase/server'
import { ScheduleEditor } from '@/components/admin/schedule-editor'
import { getAdminProfile } from '@/lib/admin/profile'

interface ScheduleRow {
  id: string
  doctor_id: string
  day_of_week: number
  start_time: string
  end_time: string
  is_active: boolean
}

interface DoctorWithSchedules {
  id: string
  name: string
  specialty: string | null
  is_active: boolean
  schedules: ScheduleRow[]
}

export default async function SchedulesPage() {
  const { clinicId } = await getAdminProfile()
  const supabase = await createClient()

  const { data: doctors } = await supabase
    .from('doctors')
    .select('id, name, specialty, is_active, schedules(id, doctor_id, day_of_week, start_time, end_time, is_active)')
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .order('name', { ascending: true })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Horarios</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Define los bloques de atención semanales por médico. Se permiten múltiples turnos por día.
        </p>
      </div>
      <ScheduleEditor doctors={(doctors ?? []) as DoctorWithSchedules[]} />
    </div>
  )
}
