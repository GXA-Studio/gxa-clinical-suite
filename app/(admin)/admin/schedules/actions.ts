'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const ScheduleSchema = z.object({
  doctor_id:   z.string().uuid(),
  day_of_week: z.coerce.number().int().min(0).max(6),
  start_time:  z.string().regex(/^\d{2}:\d{2}$/),
  end_time:    z.string().regex(/^\d{2}:\d{2}$/),
})

async function getClinicId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const { data } = await supabase.from('profiles').select('clinic_id').eq('id', user.id).single()
  if (!data?.clinic_id) throw new Error('No clinic')
  return data.clinic_id as string
}

export async function createSchedule(formData: FormData) {
  const raw = Object.fromEntries(formData)
  const parsed = ScheduleSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const clinicId = await getClinicId(supabase)

  // Verify doctor belongs to this clinic
  const { data: doctor } = await supabase
    .from('doctors').select('id').eq('id', parsed.data.doctor_id).eq('clinic_id', clinicId).single()
  if (!doctor) return { error: 'Doctor no encontrado.' }

  const { error } = await supabase.from('schedules').insert({
    doctor_id:   parsed.data.doctor_id,
    day_of_week: parsed.data.day_of_week,
    start_time:  parsed.data.start_time + ':00',
    end_time:    parsed.data.end_time   + ':00',
  })

  if (error) {
    if (error.message.includes('schedule_overlap')) return { error: 'El bloque se solapa con un turno existente.' }
    return { error: error.message }
  }

  revalidatePath('/admin/schedules')
  return { success: true }
}

export async function deleteSchedule(id: string) {
  const supabase = await createClient()
  const clinicId = await getClinicId(supabase)

  // RLS + join to verify ownership
  const { error } = await supabase
    .from('schedules')
    .delete()
    .eq('id', id)
    .eq('doctors.clinic_id', clinicId)  // enforced via RLS policy on schedules

  // Fallback: just attempt delete — RLS will block unauthorized access
  if (error) {
    await supabase.from('schedules').delete().eq('id', id)
  }

  revalidatePath('/admin/schedules')
}

export async function toggleSchedule(id: string, isActive: boolean) {
  const supabase = await createClient()
  await getClinicId(supabase) // auth check
  await supabase.from('schedules').update({ is_active: isActive }).eq('id', id)
  revalidatePath('/admin/schedules')
}
