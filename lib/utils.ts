import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatInTimeZone } from 'date-fns-tz'
import { es } from 'date-fns/locale'

// shadcn/ui standard cn helper
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ---------- Date / Timezone ----------

// Format a UTC timestamp for display in a given IANA timezone
export function formatLocalDateTime(
  utcDate: string | Date,
  timezone: string,
  fmt = "EEEE d 'de' MMMM, HH:mm"
): string {
  return formatInTimeZone(new Date(utcDate), timezone, fmt, { locale: es })
}

// Format for SMS text
export function formatSmsDateTime(utcDate: string | Date, timezone: string): string {
  return formatInTimeZone(new Date(utcDate), timezone, "dd/MM/yyyy 'a las' HH:mm", {
    locale: es,
  })
}

export function toLocalDateString(utcDate: string | Date, timezone: string): string {
  return formatInTimeZone(new Date(utcDate), timezone, 'yyyy-MM-dd')
}

// ---------- Phone ----------

// E.164: + followed by 1-9 (no leading zero country code) + 7-14 more digits = 8-15 total digits
export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone)
}

// M-04 FIX: strip control characters (incl. newlines) to prevent SMS injection
export function sanitizeName(name: string): string {
  return name.replace(/[\r\n\t\x00-\x1F\x7F]/g, ' ').trim()
}

// ---------- Base URL (server-side) ----------

// Single source of truth for the public app URL.
// Priority: NEXT_PUBLIC_APP_URL → VERCEL_PROJECT_PRODUCTION_URL → VERCEL_URL → localhost.
// VERCEL_* vars arrive WITHOUT a protocol prefix — we always prepend "https://".
// On Vercel deployments the URL is required: if none of the env vars resolves to
// a non-localhost value, we throw. The previous hardcoded `medical-booking-boilerplate`
// fallback made forks/multi-tenant deploys silently emit broken cancellation links.
export function getBaseUrl(): string {
  const onVercel = process.env.VERCEL === '1'

  const candidate =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) ??
    (process.env.VERCEL_URL                    && `https://${process.env.VERCEL_URL}`) ??
    null

  if (candidate) {
    const url = candidate.replace(/\/$/, '')
    if (onVercel && url.includes('localhost')) {
      throw new Error(
        '[getBaseUrl] Resolved URL contains "localhost" on Vercel. ' +
        'Set NEXT_PUBLIC_APP_URL in the Vercel Dashboard.'
      )
    }
    return url
  }

  if (onVercel) {
    throw new Error(
      '[getBaseUrl] Running on Vercel but no URL env var resolved. ' +
      'Set NEXT_PUBLIC_APP_URL (or rely on VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL).'
    )
  }

  console.warn('[getBaseUrl] No NEXT_PUBLIC_APP_URL set — falling back to http://localhost:3000 (dev only).')
  return 'http://localhost:3000'
}

// ---------- Misc ----------

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
