import { redirect } from 'next/navigation'
import { AdminShell } from '@/components/admin/admin-shell'
import { getAdminProfile } from '@/lib/admin/profile'
import { isGuestMode } from '@/lib/admin/guest-guard'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, clinicName, userEmail } = await getAdminProfile()
  if (!user) redirect('/auth/login')

  const isGuest = await isGuestMode()

  return (
    <AdminShell clinicName={clinicName} userEmail={userEmail} isGuest={isGuest}>
      {children}
    </AdminShell>
  )
}
