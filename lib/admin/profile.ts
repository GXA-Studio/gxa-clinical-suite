import 'server-only'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

export const getAdminProfile = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { user: null, clinicId: '', timezone: 'UTC', clinicName: 'Mi Clínica', userEmail: '' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('clinic_id, full_name, clinics(name, timezone)')
    .eq('id', user.id)
    .single()

  const clinics = profile?.clinics as { name: string; timezone: string } | null

  return {
    user,
    clinicId:   profile?.clinic_id ?? '',
    timezone:   clinics?.timezone ?? process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE ?? 'UTC',
    clinicName: clinics?.name ?? 'Mi Clínica',
    userEmail:  user.email ?? '',
  }
})
