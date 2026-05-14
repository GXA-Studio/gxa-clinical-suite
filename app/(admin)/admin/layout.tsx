import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/admin/sidebar'
import { Toaster } from '@/components/ui/toaster'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('clinic_id, full_name, clinics(name, timezone)')
    .eq('id', user.id)
    .single()

  const clinicName = (profile?.clinics as { name: string } | null)?.name ?? 'Mi Clínica'

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar clinicName={clinicName} userEmail={user.email ?? ''} />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-14 border-b border-slate-200 bg-white px-6 flex items-center justify-between shrink-0">
          <div className="h-4 w-px bg-slate-200" />
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-xs text-slate-500">Conectado</span>
          </div>
        </header>

        {/* Scrollable content area */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>

      <Toaster />
    </div>
  )
}
