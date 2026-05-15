'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { invalidateBookingCache } from '@/lib/cache'
import { z } from 'zod'

const DoctorSchema = z.object({
  name:      z.string().min(2).max(100).trim(),
  specialty: z.string().max(100).optional().nullable(),
  email:     z.string().email().optional().nullable().or(z.literal('')),
})

async function getClinicContext(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const { data: profile } = await supabase
    .from('profiles')
    .select('clinic_id, clinics(slug)')
    .eq('id', user.id)
    .single()
  if (!profile?.clinic_id) throw new Error('No clinic')
  return {
    clinicId:   profile.clinic_id as string,
    clinicSlug: (profile.clinics as { slug: string } | null)?.slug ?? null,
  }
}

export async function createDoctor(formData: FormData) {
  const raw = Object.fromEntries(formData)
  const parsed = DoctorSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const { clinicId, clinicSlug } = await getClinicContext(supabase)

  const { data: doctor, error } = await supabase
    .from('doctors')
    .insert({ clinic_id: clinicId, ...parsed.data, email: parsed.data.email || null })
    .select('id')
    .single()
  if (error) return { error: error.message }

  const serviceIds = formData.getAll('service_ids').map(String)
  if (serviceIds.length) {
    await supabase.from('doctor_services').insert(
      serviceIds.map((sid) => ({ doctor_id: doctor.id, service_id: sid }))
    )
  }

  revalidatePath('/admin/doctors')
  if (clinicSlug) await invalidateBookingCache(clinicSlug)
  return { success: true }
}

export async function updateDoctor(id: string, formData: FormData) {
  const raw = Object.fromEntries(formData)
  const parsed = DoctorSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const { clinicId, clinicSlug } = await getClinicContext(supabase)

  const { error } = await supabase.from('doctors')
    .update({ ...parsed.data, email: parsed.data.email || null })
    .eq('id', id).eq('clinic_id', clinicId)
  if (error) return { error: error.message }

  await supabase.from('doctor_services').delete().eq('doctor_id', id)
  const serviceIds = formData.getAll('service_ids').map(String)
  if (serviceIds.length) {
    await supabase.from('doctor_services').insert(
      serviceIds.map((sid) => ({ doctor_id: id, service_id: sid }))
    )
  }

  revalidatePath('/admin/doctors')
  if (clinicSlug) await invalidateBookingCache(clinicSlug)
  return { success: true }
}

export async function toggleDoctor(id: string, isActive: boolean) {
  const supabase = await createClient()
  const { clinicId, clinicSlug } = await getClinicContext(supabase)
  await supabase.from('doctors').update({ is_active: isActive }).eq('id', id).eq('clinic_id', clinicId)
  revalidatePath('/admin/doctors')
  if (clinicSlug) await invalidateBookingCache(clinicSlug)
}
