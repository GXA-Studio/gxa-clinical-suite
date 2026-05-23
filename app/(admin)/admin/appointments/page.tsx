import { Suspense } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { AppointmentsTable } from '@/components/admin/appointments-table'
import { NewAppointmentDialog } from '@/components/admin/new-appointment-dialog'
import { getAdminProfile } from '@/lib/admin/profile'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react'

// P-5 — Bound the appointments query so admins with long histories don't
// pay for hundreds of rows on every navigation. The 50-row page size is the
// same shape the table renders comfortably on the smallest viewport.
const PAGE_SIZE = 50

// ─── Inner skeleton (table area only) ────────────────────────────────────────
// Shown by the Suspense boundary while appointments stream in.
// The page shell (header + dialog button) is already visible at this point.
function AppointmentsTableSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="border-slate-200/70">
            <CardContent className="p-4">
              <Skeleton className="mb-2 h-3 w-16" />
              <Skeleton className="h-8 w-10" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Skeleton className="h-9 w-full" />
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-44" />
      </div>
      <Card className="border-slate-200/70">
        <CardContent className="p-0">
          <div className="flex gap-4 border-b border-slate-100 px-4 py-3">
            {[24, 32, 28, 16].map((w, i) => (
              <Skeleton key={i} className={`h-4 w-${w}`} />
            ))}
          </div>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-4 border-b border-slate-100 px-4 py-3 last:border-0">
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-28" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-8 w-8 shrink-0 rounded" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Async data component (inside Suspense) ───────────────────────────────────
// This is the only thing that blocks on the slow appointments query.
const SORT_MAP: Record<string, { col: string; asc: boolean }> = {
  date_asc:     { col: 'starts_at',    asc: true  },
  date_desc:    { col: 'starts_at',    asc: false },
  patient_asc:  { col: 'patient_name', asc: true  },
  patient_desc: { col: 'patient_name', asc: false },
  created_desc: { col: 'created_at',   asc: false },
}

function buildPageUrl(
  page: number,
  searchParams: { status?: string; date?: string; q?: string; sort?: string },
): string {
  const params = new URLSearchParams()
  if (searchParams.status) params.set('status', searchParams.status)
  if (searchParams.date)   params.set('date',   searchParams.date)
  if (searchParams.q)      params.set('q',      searchParams.q)
  if (searchParams.sort)   params.set('sort',   searchParams.sort)
  if (page > 1)            params.set('page',   String(page))
  const qs = params.toString()
  return qs ? `/admin/appointments?${qs}` : '/admin/appointments'
}

async function AppointmentsSection({
  clinicId,
  timezone,
  status,
  date,
  q,
  sort,
  page,
}: {
  clinicId: string
  timezone: string
  status?: string
  date?: string
  q?: string
  sort?: string
  page: number
}) {
  const supabase = await createClient()
  const { col: sortCol, asc: sortAsc } = SORT_MAP[sort ?? 'date_asc'] ?? SORT_MAP.date_asc
  const offset = (page - 1) * PAGE_SIZE

  let query = supabase
    .from('appointments')
    .select(`
      id, patient_name, patient_phone, starts_at, ends_at, status, created_at, notes,
      doctors(id, name, specialty),
      services(id, name, duration_minutes)
    `)
    .eq('clinic_id', clinicId)
    .order(sortCol, { ascending: sortAsc })
    .range(offset, offset + PAGE_SIZE - 1)

  if (status && status !== 'all') {
    query = query.eq('status', status as 'confirmed' | 'cancelled')
  }
  if (date) {
    const dayStart = new Date(date + 'T00:00:00.000Z').toISOString()
    const dayEnd   = new Date(date + 'T23:59:59.999Z').toISOString()
    query = query.gte('starts_at', dayStart).lte('starts_at', dayEnd)
  }
  if (q?.trim()) {
    // Strip characters that are delimiters in PostgREST's .or() syntax
    const safe = q.trim().slice(0, 100).replace(/[,()]/g, '')
    if (safe) {
      query = query.or(
        `patient_name.ilike.%${safe}%,patient_phone.ilike.%${safe}%`
      )
    }
  }

  const { data: appointments } = await query
  const rows = appointments ?? []
  // Heuristic: a full page implies there may be more (avoids a count(*) query).
  const hasNext = rows.length === PAGE_SIZE

  return (
    <>
      <AppointmentsTable appointments={rows} timezone={timezone} />
      {(page > 1 || hasNext) && (
        <div className="flex items-center justify-between gap-3 pt-2">
          <span className="text-xs text-muted-foreground">Página {page}</span>
          <div className="flex items-center gap-2">
            {page > 1 ? (
              <Button asChild variant="outline" size="sm" className="gap-1">
                <Link href={buildPageUrl(page - 1, { status, date, q, sort })}>
                  <ChevronLeft className="h-4 w-4" /> Anterior
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="gap-1" disabled>
                <ChevronLeft className="h-4 w-4" /> Anterior
              </Button>
            )}
            {hasNext ? (
              <Button asChild variant="outline" size="sm" className="gap-1">
                <Link href={buildPageUrl(page + 1, { status, date, q, sort })}>
                  Siguiente <ChevronRight className="h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="gap-1" disabled>
                Siguiente <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ─── Dialog data loader (inside its own Suspense) ────────────────────────────
// Fetches doctors+services only when needed for the dialog, in parallel with
// the appointments table — not on the critical path for the page shell.
async function DialogLoader({ clinicId }: { clinicId: string }) {
  const supabase = await createClient()
  const [{ data: doctors }, { data: services }] = await Promise.all([
    supabase
      .from('doctors')
      .select('id, name, specialty, doctor_services(service_id)')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('services')
      .select('id, name, duration_minutes')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('name'),
  ])
  return <NewAppointmentDialog doctors={doctors ?? []} services={services ?? []} />
}

// ─── Page shell (renders immediately after getAdminProfile resolves) ──────────
export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; date?: string; q?: string; sort?: string; page?: string }>
}) {
  const { status, date, q, sort, page: pageRaw } = await searchParams
  const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1)
  const { clinicId, timezone } = await getAdminProfile()

  return (
    <div className="space-y-6">
      {/* Header — visible immediately after profile resolves */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Citas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Historial y gestión de todas las citas de la clínica.
          </p>
        </div>
        {/* Dialog data streams in parallel with the table — no longer on critical path */}
        <Suspense fallback={
          <Button size="sm" className="gap-1.5" disabled>
            <Plus className="h-4 w-4" />
            Nueva cita
          </Button>
        }>
          <DialogLoader clinicId={clinicId} />
        </Suspense>
      </div>

      {/* Table — streams in independently once appointments query resolves */}
      <Suspense fallback={<AppointmentsTableSkeleton />}>
        <AppointmentsSection
          clinicId={clinicId}
          timezone={timezone}
          status={status}
          date={date}
          q={q}
          sort={sort}
          page={page}
        />
      </Suspense>
    </div>
  )
}
