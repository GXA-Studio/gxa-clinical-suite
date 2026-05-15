import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/available-days?serviceId=<uuid>
//
// Returns the distinct days-of-week (0=Sun … 6=Sat) on which at least one
// active doctor offering this service has an active schedule block.
// The client uses this to disable calendar days before any DB round-trip.
//
// Note: this is a schedule-level check, not a real-time slot check. A day
// whose DOW matches may still show "no slots" if all appointments are booked.
// That edge case is handled gracefully in the slot picker step.
export async function GET(req: NextRequest) {
  const serviceId = req.nextUrl.searchParams.get('serviceId')

  if (!serviceId) {
    return NextResponse.json({ error: 'serviceId is required' }, { status: 400 })
  }

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRe.test(serviceId)) {
    return NextResponse.json({ error: 'Invalid serviceId format' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data, error } = await supabase.rpc('get_active_dow_for_service', {
    p_service_id: serviceId,
  })

  if (error) {
    console.error('[GET /api/available-days]', error)
    return NextResponse.json({ error: 'Failed to fetch available days' }, { status: 500 })
  }

  const activeDow = (data ?? []).map((r: { day_of_week: number }) => r.day_of_week)

  return NextResponse.json(
    { activeDow },
    { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' } }
  )
}
