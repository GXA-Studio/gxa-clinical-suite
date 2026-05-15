import { redirect } from 'next/navigation'
import { AdminShell } from '@/components/admin/admin-shell'
import { getAdminProfile } from '@/lib/admin/profile'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, clinicName, userEmail } = await getAdminProfile()
  if (!user) redirect('/auth/login')

  return (
    <AdminShell clinicName={clinicName} userEmail={userEmail}>
      {children}
    </AdminShell>
  )
}
