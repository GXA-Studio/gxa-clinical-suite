import type { NextConfig } from 'next'

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
      // Supabase REST + Realtime WebSocket
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://lenient-buck-124268.upstash.io",
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
