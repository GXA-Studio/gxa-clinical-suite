import 'server-only'
import { Redis } from '@upstash/redis'
import type { ClinicBookingData } from '@/components/booking/types'

const BOOKING_TTL = 300 // 5 minutes

let _redis: Redis | null = null
let _initFailed = false

function tryGetRedis(): Redis | null {
  if (_initFailed) return null
  if (_redis) return _redis
  try {
    _redis = Redis.fromEnv()
    return _redis
  } catch {
    _initFailed = true
    return null
  }
}

const BOOKING_KEY = (slug: string) => `mbb:booking:${slug}`

export async function getBookingData(
  clinicSlug: string,
  fetcher: () => Promise<ClinicBookingData | null>,
): Promise<ClinicBookingData | null> {
  const redis = tryGetRedis()
  if (!redis) return fetcher()

  try {
    const cached = await redis.get<ClinicBookingData>(BOOKING_KEY(clinicSlug))
    if (cached) return cached

    const fresh = await fetcher()
    if (fresh) await redis.set(BOOKING_KEY(clinicSlug), fresh, { ex: BOOKING_TTL })
    return fresh
  } catch {
    // Redis unavailable — fall back to DB
    return fetcher()
  }
}

export async function invalidateBookingCache(clinicSlug: string): Promise<void> {
  const redis = tryGetRedis()
  if (!redis) return
  try {
    await redis.del(BOOKING_KEY(clinicSlug))
  } catch {
    // ignore — next read will get fresh data after TTL
  }
}
