import type { NextConfig } from 'next'

// Derive the Upstash REST host from the configured URL so rotating clusters
// only requires changing the env var. Falls back to a wildcard match if the
// var is unset (dev) — fetch will still go through, no silent CSP block.
function upstashConnectSrc(): string {
  const raw = process.env.UPSTASH_REDIS_REST_URL
  if (!raw) return 'https://*.upstash.io'
  try {
    return `https://${new URL(raw).host}`
  } catch {
    console.warn('[next.config] UPSTASH_REDIS_REST_URL is malformed; widening CSP to https://*.upstash.io')
    return 'https://*.upstash.io'
  }
}

const securityHeaders = [
  // H-03 FIX: prevent embedding in iframes (clickjacking on booking form)
  { key: 'X-Frame-Options',        value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy',        value: 'strict-origin-when-cross-origin' },
  // HSTS: enforce HTTPS for 2 years, include subdomains, preload eligible
  {
    key:   'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key:   'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Next.js requires unsafe-inline + unsafe-eval for runtime hydration
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://*.supabase.co",
      // Supabase REST + Realtime WebSocket + Upstash Redis (derived from env)
      `connect-src 'self' https://*.supabase.co wss://*.supabase.co ${upstashConnectSrc()}`,
      "font-src 'self' data: https://fonts.gstatic.com",
      "frame-ancestors 'none'",
    ].join('; '),
  },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // H-03 FIX: Apply security headers to all routes
  async headers() {
    return [
      {
        source:  '/(.*)',
        headers: securityHeaders,
      },
    ]
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },

  // Prevent Twilio (server-only) from being bundled in client chunks
  serverExternalPackages: ['twilio'],
}

export default nextConfig
