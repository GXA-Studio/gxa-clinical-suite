'use server'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { slotsLimiter } from '@/lib/rate-limit'

const MAX_DAYS   = 45
const BATCH_SIZE = 9   // 45 days ÷ 9 = 5 round-trips; each batch parallel via Promise.all

function getClientIp(h: Headers): string {
  return (
    h.get('x-forwarded-for')?.split(',')[0].trim() ??
    h.get('x-real-ip') ??
    'unknown'
  )
}

/**
 * Scans up to MAX_DAYS to find the first calendar date with at least one
 * slot strictly beyond the 15-min grace window.
 *
 * S-7 PATCH: batched parallel scan + per-IP rate-limit.
 *   - 5 batches × 9 days, each batch resolved with Promise.all → total time
 *     is roughly one RPC round-trip per batch (~200 ms) instead of 45 sequential.
 *   - Early-return on the first hit avoids issuing later batches.
 *   - Per-IP limiter prevents a single client from forcing 45 RPCs per call.
 */
export async function findNextAvailableDate(
  serviceId: string,
  doctorId:  string | null,
  startDate: string,
): Promise<string | null> {
  // S-7.a: rate-limit per IP. We reuse slotsLimiter (60/min) since this scan
  // is functionally equivalent to repeated /api/slots calls.
  const reqHeaders = await headers()
  try {
    const { success } = await slotsLimiter.limit(getClientIp(reqHeaders))
    if (!success) return null   // fail-closed; UI shows "no date found"
  } catch {
    // Fail open if Redis is unavailable
  }

  const supabase = await createClient()
  const cutoff   = new Date(Date.now() + 15 * 60 * 1000)
  const base     = new Date(startDate + 'T00:00:00Z')

  const probeDay = async (offset: number): Promise<string | null> => {
    const d = new Date(base)
    d.setUTCDate(base.getUTCDate() + offset)
    const dateStr = d.toISOString().slice(0, 10)

    if (doctorId) {
      const { data } = await supabase.rpc('get_available_slots', {
        p_doctor_id:  doctorId,
        p_service_id: serviceId,
        p_date:       dateStr,
      })
      const slots = (data ?? []) as { slot_start: string }[]
      return slots.some((s) => new Date(s.slot_start) > cutoff) ? dateStr : null
    }

    const { data } = await supabase.rpc('get_slots_for_service', {
      p_service_id: serviceId,
      p_date:       dateStr,
    })
    const slots = (data ?? []) as { slot_start: string }[]
    return slots.some((s) => new Date(s.slot_start) > cutoff) ? dateStr : null
  }

  // S-7.b: batched scan. Offsets within a batch resolve concurrently;
  // batches run sequentially so we can short-circuit on the first hit.
  for (let batchStart = 0; batchStart < MAX_DAYS; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, MAX_DAYS)
    const offsets  = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i)
    const results  = await Promise.all(offsets.map(probeDay))
    const firstHit = results.find((d): d is string => d !== null)
    if (firstHit) return firstHit
  }

  return null
}
