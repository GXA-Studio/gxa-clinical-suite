import 'server-only'
import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// DB-only portion cached for 5 min across requests (keyed by userId).
// auth.getUser() is never cached — it must always hit Supabase for security.
const fetchProfileData = unstable_cache(
  async (userId: string) => {
    const { data } = await createServiceClient()
      .from('profiles')
      .select('clinic_id, full_name, clinics(name, timezone)')
      .eq('id', userId)
      .single()
    return data ?? null
  },
  ['admin-profile-data'],
  { revalidate: 300, tags: ['admin-profile'] },
)

export const getAdminProfile = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { user: null, clinicId: '', timezone: 'UTC', clinicName: 'Mi Clínica', userEmail: '' }
  }

  const profile = await fetchProfileData(user.id)
  const clinics = profile?.clinics as { name: string; timezone: string } | null

  return {
    user,
    clinicId:   profile?.clinic_id ?? '',
    timezone:   clinics?.timezone ?? process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE ?? 'UTC',
    clinicName: clinics?.name ?? 'Mi Clínica',
    userEmail:  user.email ?? '',
  }
})
