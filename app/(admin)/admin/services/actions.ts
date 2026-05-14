'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const ServiceSchema = z.object({
  name:             z.string().min(2).max(100).trim(),
  duration_minutes: z.coerce.number().int().min(5).max(480),
  price:            z.coerce.number().min(0).optional().nullable(),
  description:      z.string().max(500).optional().nullable(),
})

async function getClinicId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const { data: profile } = await supabase
    .from('profiles').select('clinic_id').eq('id', user.id).single()
  if (!profile?.clinic_id) throw new Error('No clinic associated')
  return profile.clinic_id as string
}

export async function createService(formData: FormData) {
  const raw = Object.fromEntries(formData)
  const parsed = ServiceSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const clinicId = await getClinicId(supabase)

  const { error } = await supabase.from('services').insert({ clinic_id: clinicId, ...parsed.data })
  if (error) return { error: error.message }

  revalidatePath('/admin/services')
  return { success: true }
}

export async function updateService(id: string, formData: FormData) {
  const raw = Object.fromEntries(formData)
  const parsed = ServiceSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const clinicId = await getClinicId(supabase)

  const { error } = await supabase.from('services').update(parsed.data)
    .eq('id', id).eq('clinic_id', clinicId)
  if (error) return { error: error.message }

  revalidatePath('/admin/services')
  return { success: true }
}

export async function toggleService(id: string, isActive: boolean) {
  const supabase = await createClient()
  const clinicId = await getClinicId(supabase)
  await supabase.from('services').update({ is_active: isActive }).eq('id', id).eq('clinic_id', clinicId)
  revalidatePath('/admin/services')
}
