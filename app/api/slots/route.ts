import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'  // H-02 FIX: anon key — no elevated privileges needed

// GET /api/slots?doctorId=<uuid>&serviceId=<uuid>&date=YYYY-MM-DD
//
// get_available_slots is GRANT EXECUTE TO anon — the anon client is sufficient.
// Using createServiceClient() here would violate least-privilege (H-02 finding).
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const doctorId  = searchParams.get('doctorId')
  const serviceId = searchParams.get('serviceId')
  const date      = searchParams.get('date')

  if (!doctorId || !serviceId || !date) {
    return NextResponse.json(
      { error: 'doctorId, serviceId, and date query params are required' },
      { status: 400 }
    )
  }

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRe.test(doctorId) || !uuidRe.test(serviceId)) {
    return NextResponse.json({ error: 'Invalid doctorId or serviceId format' }, { status: 400 })
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: slots, error } = await supabase.rpc('get_available_slots', {
    p_doctor_id:  doctorId,
    p_service_id: serviceId,
    p_date:       date,
  })

  if (error) {
    if (error.code === 'P0003' || error.code === 'P0004') {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    console.error('[GET /api/slots]', error)
    return NextResponse.json({ error: 'Failed to fetch available slots' }, { status: 500 })
  }

  return NextResponse.json(
    { slots: (slots ?? []).map((s: { slot_start: string }) => s.slot_start) },
    { headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' } }
  )
}
