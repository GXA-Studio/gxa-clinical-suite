import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

export const GUEST_COOKIE  = 'mbb_guest'
const       DEMO_EMAIL     = 'admin@demo.com'

export async function isGuestMode(): Promise<boolean> {
  const jar = await cookies()
  if (jar.get(GUEST_COOKIE)?.value !== '1') return false
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.email === DEMO_EMAIL
}

export const DEMO_RESULT = { demo: true } as const
