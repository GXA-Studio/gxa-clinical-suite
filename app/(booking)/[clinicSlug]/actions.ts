'use server'
import { createClient } from '@/lib/supabase/server'

const MAX_DAYS = 45

/**
 * Scans day-by-day (server-side, no HTTP round-trips) to find the first date
 * that has at least one slot beyond the 15-min grace window.
 * Returns a YYYY-MM-DD string or null if nothing found within MAX_DAYS.
 */
export async function findNextAvailableDate(
  serviceId: string,
  doctorId:  string | null,
  startDate: string,          // YYYY-MM-DD — where to begin the scan
): Promise<string | null> {
  const supabase = await createClient()
  const cutoff   = new Date(Date.now() + 15 * 60 * 1000)
  const base     = new Date(startDate + 'T00:00:00Z')

  for (let i = 0; i < MAX_DAYS; i++) {
    const d = new Date(base)
    d.setUTCDate(base.getUTCDate() + i)
    const dateStr = d.toISOString().slice(0, 10)

    if (doctorId) {
      const { data } = await supabase.rpc('get_available_slots', {
        p_doctor_id:  doctorId,
        p_service_id: serviceId,
        p_date:       dateStr,
      })
      const slots = (data ?? []) as { slot_start: string }[]
      if (slots.some((s) => new Date(s.slot_start) > cutoff)) return dateStr
    } else {
      const { data } = await supabase.rpc('get_slots_for_service', {
        p_service_id: serviceId,
        p_date:       dateStr,
      })
      const slots = (data ?? []) as { slot_start: string }[]
      if (slots.some((s) => new Date(s.slot_start) > cutoff)) return dateStr
    }
  }

  return null
}
