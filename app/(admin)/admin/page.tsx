import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CalendarDays, CheckCircle2, Clock, XCircle } from 'lucide-react'
import { formatLocalDateTime } from '@/lib/utils'

export default async function AdminDashboardPage() {
  const supabase = await createClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('clinic_id, clinics(timezone)')
    .eq('id', (await supabase.auth.getUser()).data.user!.id)
    .single()

  const clinicId = profile?.clinic_id
  const timezone = (profile?.clinics as { timezone: string } | null)?.timezone ?? 'UTC'

  if (!clinicId) {
    return (
      <div className="flex h-96 items-center justify-center text-muted-foreground text-sm">
        Esta cuenta no tiene una clínica asociada. Contacta al administrador del sistema.
      </div>
    )
  }

  const today     = new Date()
  const todayStart = new Date(today.setHours(0, 0, 0, 0)).toISOString()
  const todayEnd   = new Date(today.setHours(23, 59, 59, 999)).toISOString()
  const weekStart  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [
    { data: todayAppts },
    { data: pendingAppts },
    { data: weekConfirmed },
    { data: recentAppts },
  ] = await Promise.all([
    supabase.from('appointments').select('id').eq('clinic_id', clinicId)
      .gte('starts_at', todayStart).lte('starts_at', todayEnd).neq('status', 'cancelled'),
    supabase.from('appointments').select('id').eq('clinic_id', clinicId).eq('status', 'pending'),
    supabase.from('appointments').select('id').eq('clinic_id', clinicId).eq('status', 'confirmed')
      .gte('starts_at', weekStart),
    supabase.from('appointments').select(`
      id, patient_name, starts_at, status,
      doctors(name), services(name)
    `).eq('clinic_id', clinicId)
      .order('starts_at', { ascending: false })
      .limit(8),
  ])

  const stats = [
    { label: 'Citas hoy',          value: todayAppts?.length ?? 0,    icon: CalendarDays, color: 'text-primary',    bg: 'bg-primary/10' },
    { label: 'Pendientes de OTP',   value: pendingAppts?.length ?? 0,  icon: Clock,        color: 'text-amber-600',  bg: 'bg-amber-50' },
    { label: 'Confirmadas (7d)',    value: weekConfirmed?.length ?? 0, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  ]

  const statusConfig: Record<string, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }> = {
    confirmed: { label: 'Confirmada', variant: 'success' },
    pending:   { label: 'Pendiente',  variant: 'warning' },
    cancelled: { label: 'Cancelada',  variant: 'destructive' },
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Resumen general de la clínica</p>
      </div>

      {/* Stats grid */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label} className="border-slate-200/70">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{s.label}</p>
                  <p className="text-3xl font-bold text-slate-900 mt-1">{s.value}</p>
                </div>
                <div className={`rounded-xl ${s.bg} p-3`}>
                  <s.icon className={`h-5 w-5 ${s.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent appointments */}
      <Card className="border-slate-200/70">
        <CardHeader>
          <CardTitle className="text-base">Citas recientes</CardTitle>
          <CardDescription>Últimas 8 citas registradas</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-slate-100">
                <TableHead>Paciente</TableHead>
                <TableHead>Médico</TableHead>
                <TableHead>Servicio</TableHead>
                <TableHead>Fecha y hora</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(recentAppts ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No hay citas registradas.
                  </TableCell>
                </TableRow>
              ) : (
                (recentAppts ?? []).map((appt) => {
                  const sc = statusConfig[appt.status as string] ?? { label: appt.status, variant: 'secondary' as const }
                  return (
                    <TableRow key={appt.id} className="border-slate-100">
                      <TableCell className="font-medium">{appt.patient_name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {(appt.doctors as { name: string } | null)?.name ?? '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {(appt.services as { name: string } | null)?.name ?? '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatLocalDateTime(appt.starts_at, timezone, "dd/MM/yyyy HH:mm")}
                      </TableCell>
                      <TableCell>
                        <Badge variant={sc.variant}>{sc.label}</Badge>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
