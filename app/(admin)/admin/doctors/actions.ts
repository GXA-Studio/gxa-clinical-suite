'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const DoctorSchema = z.object({
  name:      z.string().min(2).max(100).trim(),
  specialty: z.string().max(100).optional().nullable(),
  email:     z.string().email().optional().nullable().or(z.literal('')),
})

async function getClinicId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const { data } = await supabase.from('profiles').select('clinic_id').eq('id', user.id).single()
  if (!data?.clinic_id) throw new Error('No clinic')
  return data.clinic_id as string
}

export async function createDoctor(formData: FormData) {
  const raw = Object.fromEntries(formData)
  const parsed = DoctorSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const clinicId = await getClinicId(supabase)

  const { data: doctor, error } = await supabase
    .from('doctors')
    .insert({ clinic_id: clinicId, ...parsed.data, email: parsed.data.email || null })
    .select('id')
    .single()
  if (error) return { error: error.message }

  // Assign services
  const serviceIds = formData.getAll('service_ids').map(String)
  if (serviceIds.length) {
    await supabase.from('doctor_services').insert(
      serviceIds.map((sid) => ({ doctor_id: doctor.id, service_id: sid }))
    )
  }

  revalidatePath('/admin/doctors')
  return { success: true }
}

export async function updateDoctor(id: string, formData: FormData) {
  const raw = Object.fromEntries(formData)
  const parsed = DoctorSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const clinicId = await getClinicId(supabase)

  const { error } = await supabase.from('doctors')
    .update({ ...parsed.data, email: parsed.data.email || null })
    .eq('id', id).eq('clinic_id', clinicId)
  if (error) return { error: error.message }

  // Re-sync services
  await supabase.from('doctor_services').delete().eq('doctor_id', id)
  const serviceIds = formData.getAll('service_ids').map(String)
  if (serviceIds.length) {
    await supabase.from('doctor_services').insert(
      serviceIds.map((sid) => ({ doctor_id: id, service_id: sid }))
    )
  }

  revalidatePath('/admin/doctors')
  return { success: true }
}

export async function toggleDoctor(id: string, isActive: boolean) {
  const supabase = await createClient()
  const clinicId = await getClinicId(supabase)
  await supabase.from('doctors').update({ is_active: isActive }).eq('id', id).eq('clinic_id', clinicId)
  revalidatePath('/admin/doctors')
}
