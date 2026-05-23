'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { invalidateBookingCache } from '@/lib/cache'
import { isGuestMode, DEMO_RESULT } from '@/lib/admin/guest-guard'
import { z } from 'zod'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

// S-8 PATCH: verify every service_id belongs to the admin's clinic before
// linking them via doctor_services. The RLS policy on doctor_services only
// checks ownership through doctor_id; without this app-side guard an admin
// could craft a request linking their doctor to ANOTHER clinic's services.
// Returns `null` on success, or an error string on tenant violation.
async function assertServicesBelongToClinic(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clinicId: string,
  rawServiceIds: string[],
): Promise<{ uniqueIds: string[] } | { error: string }> {
  const uniqueIds = [...new Set(rawServiceIds)]
  if (uniqueIds.length === 0) return { uniqueIds: [] }
  if (uniqueIds.some((id) => !UUID_RE.test(id))) {
    return { error: 'Servicio inválido.' }
  }

  const { data: validRows, error } = await supabase
    .from('services')
    .select('id')
    .eq('clinic_id', clinicId)
    .in('id', uniqueIds)

  if (error) {
    console.error('[assertServicesBelongToClinic] DB error:', error)
    return { error: 'Error al validar los servicios.' }
  }
  if ((validRows?.length ?? 0) !== uniqueIds.length) {
    return { error: 'CROSS_TENANT_VIOLATION: uno o más servicios no pertenecen a tu clínica.' }
  }
  return { uniqueIds }
}

export async function createDoctor(formData: FormData) {
  if (await isGuestMode()) return DEMO_RESULT
  const raw = Object.fromEntries(formData)
  const parsed = DoctorSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const { clinicId, clinicSlug } = await getClinicContext(supabase)

  // S-8: validate service ownership BEFORE creating the doctor so we don't
  // leave an orphan doctor row on tenant-violation.
  const rawServiceIds = formData.getAll('service_ids').map(String)
  const assertion = await assertServicesBelongToClinic(supabase, clinicId, rawServiceIds)
  if ('error' in assertion) return { error: assertion.error }

  const { data: doctor, error } = await supabase
    .from('doctors')
    .insert({ clinic_id: clinicId, ...parsed.data, email: parsed.data.email || null })
    .select('id')
    .single()
  if (error) {
    console.error('[createDoctor] DB error:', error)
    return { error: 'Error al guardar el médico.' }
  }

  if (assertion.uniqueIds.length) {
    await supabase.from('doctor_services').insert(
      assertion.uniqueIds.map((sid) => ({ doctor_id: doctor.id, service_id: sid }))
    )
  }

  revalidatePath('/admin/doctors')
  if (clinicSlug) await invalidateBookingCache(clinicSlug)
  return { success: true }
}

export async function updateDoctor(id: string, formData: FormData) {
  if (await isGuestMode()) return DEMO_RESULT
  if (!UUID_RE.test(id)) return { error: 'ID no válido.' }

  const raw = Object.fromEntries(formData)
  const parsed = DoctorSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const { clinicId, clinicSlug } = await getClinicContext(supabase)

  // S-8: validate service ownership BEFORE mutating doctor_services so we
  // don't blank out the existing links on a tenant-violation request.
  const rawServiceIds = formData.getAll('service_ids').map(String)
  const assertion = await assertServicesBelongToClinic(supabase, clinicId, rawServiceIds)
  if ('error' in assertion) return { error: assertion.error }

  const { error } = await supabase.from('doctors')
    .update({ ...parsed.data, email: parsed.data.email || null })
    .eq('id', id).eq('clinic_id', clinicId)
  if (error) {
    console.error('[updateDoctor] DB error:', error)
    return { error: 'Error al guardar el médico.' }
  }

  // B-6 — atomic DELETE+INSERT inside a single PG function so the wizard never
  // observes a doctor with zero services between the two calls.
  const { error: linkError } = await supabase.rpc('update_doctor_with_services', {
    p_doctor_id:   id,
    p_service_ids: assertion.uniqueIds,
  })
  if (linkError) {
    console.error('[updateDoctor] update_doctor_with_services error:', linkError)
    return { error: 'Error al actualizar los servicios del médico.' }
  }

  revalidatePath('/admin/doctors')
  if (clinicSlug) await invalidateBookingCache(clinicSlug)
  return { success: true }
}

export async function toggleDoctor(id: string, isActive: boolean) {
  if (await isGuestMode()) return DEMO_RESULT
  if (!UUID_RE.test(id)) return
  const supabase = await createClient()
  const { clinicId, clinicSlug } = await getClinicContext(supabase)
  await supabase.from('doctors').update({ is_active: isActive }).eq('id', id).eq('clinic_id', clinicId)
  revalidatePath('/admin/doctors')
  if (clinicSlug) await invalidateBookingCache(clinicSlug)
}
