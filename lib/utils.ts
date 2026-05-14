import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { createHash, createHmac, randomInt } from 'crypto'
import { formatInTimeZone } from 'date-fns-tz'
import { es } from 'date-fns/locale'

// shadcn/ui standard cn helper
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ---------- OTP ----------

// L-01 FIX: exclusive upper bound → use 1_000_000 to include 999999 (full 900,000 space)
export function generateOTP(): string {
  return String(randomInt(100000, 1_000_000))
}

// M-02 FIX: HMAC-SHA256 with server-side pepper prevents rainbow table attacks.
// Even if otp_code_hash column is leaked, reversing requires knowing OTP_HASH_PEPPER.
export function hashOTP(otp: string): string {
  const pepper = process.env.OTP_HASH_PEPPER
  if (!pepper) throw new Error('OTP_HASH_PEPPER env var must be set')
  return createHmac('sha256', pepper).update(otp).digest('hex')
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

// ---------- Misc ----------

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
