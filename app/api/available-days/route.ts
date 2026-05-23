import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/available-days?serviceId=<uuid>
//
// Returns two complementary signals the public calendar uses to disable days
// before any slot round-trip:
//   1. activeDow   — distinct days-of-week (0=Sun … 6=Sat) on which at least
//                    one active doctor offering this service has an active
//                    schedule block. Structural; insensible to exceptions.
//   2. blockedDates — YYYY-MM-DD dates within the next 90 days on which
//                    EVERY active doctor offering this service has a
//                    full-day-off exception. These dates pass the activeDow
//                    check structurally but would yield zero slots; surface
//                    them so the calendar can grey them out (B-5).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const HORIZON_DAYS = 90

function toLocalIsoDate(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

export async function GET(req: NextRequest) {
  const serviceId = req.nextUrl.searchParams.get('serviceId')

  if (!serviceId) {
    return NextResponse.json({ error: 'serviceId is required' }, { status: 400 })
  }
  if (!UUID_RE.test(serviceId)) {
    return NextResponse.json({ error: 'Invalid serviceId format' }, { status: 400 })
  }

  const supabase = await createClient()

  const [dowRes, doctorsRes] = await Promise.all([
    supabase.rpc('get_active_dow_for_service', { p_service_id: serviceId }),
    supabase
      .from('doctor_services')
      .select('doctor_id, doctors!inner(is_active)')
      .eq('service_id', serviceId)
      .eq('doctors.is_active', true),
  ])

  if (dowRes.error) {
    console.error('[GET /api/available-days] dow error:', dowRes.error)
    return NextResponse.json({ error: 'Failed to fetch available days' }, { status: 500 })
  }
  if (doctorsRes.error) {
    console.error('[GET /api/available-days] doctors error:', doctorsRes.error)
    return NextResponse.json({ error: 'Failed to fetch doctors' }, { status: 500 })
  }

  const activeDow = (dowRes.data ?? []).map((r: { day_of_week: number }) => r.day_of_week)
  const doctorIds = (doctorsRes.data ?? []).map((r: { doctor_id: string }) => r.doctor_id)

  let blockedDates: string[] = []
  if (doctorIds.length > 0) {
    const today   = new Date()
    const horizon = new Date(today.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000)

    const { data: exceptions, error: excErr } = await supabase
      .from('doctor_schedule_exceptions')
      .select('exception_date, doctor_id')
      .in('doctor_id', doctorIds)
      .eq('is_working', false)
      .is('start_time', null)
      .gte('exception_date', toLocalIsoDate(today))
      .lte('exception_date', toLocalIsoDate(horizon))

    if (excErr) {
      console.error('[GET /api/available-days] exceptions error:', excErr)
    } else {
      const perDate = new Map<string, Set<string>>()
      for (const e of exceptions ?? []) {
        const s = perDate.get(e.exception_date) ?? new Set<string>()
        s.add(e.doctor_id)
        perDate.set(e.exception_date, s)
      }
      blockedDates = [...perDate.entries()]
        .filter(([, ds]) => ds.size >= doctorIds.length)
        .map(([d]) => d)
        .sort()
    }
  }

  return NextResponse.json(
    { activeDow, blockedDates },
    { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' } }
  )
}
