import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { GUEST_COOKIE } from '@/lib/admin/guest-guard'
import { demoLimiter } from '@/lib/rate-limit'

const DEMO_EMAIL    = 'admin@demo.com'
const DEMO_PASSWORD = 'demo1234'

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  )
}

export async function GET(request: NextRequest) {
  // S-6 PATCH: rate-limit per IP — prevents abuse of the auto-login flow
  // against Supabase Auth (hardcoded demo credentials).
  try {
    const { success } = await demoLimiter.limit(getClientIp(request))
    if (!success) {
      return new NextResponse(
        'Demasiados intentos. Vuelve a intentarlo en un minuto.',
        { status: 429 }
      )
    }
  } catch (err) {
    // Fail open: if Redis is unavailable, do not block the demo
    console.warn('[admin/guest] Rate limiter unavailable, proceeding:', err)
  }

  const redirectUrl = new URL('/admin', request.nextUrl.origin)
  const response    = NextResponse.redirect(redirectUrl)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  await supabase.auth.signInWithPassword({ email: DEMO_EMAIL, password: DEMO_PASSWORD })

  // S-5 PATCH: harden the demo cookie. Server-only flow (cookie consumed by
  // Server Components + middleware), so JS access is unnecessary and risky.
  response.cookies.set(GUEST_COOKIE, '1', {
    path:     '/admin',
    httpOnly: true,
    secure:   true,
    sameSite: 'strict',
    maxAge:   60 * 60 * 2,
  })

  return response
}
