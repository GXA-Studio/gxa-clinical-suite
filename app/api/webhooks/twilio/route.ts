import { type NextRequest } from 'next/server'
import { validateRequest } from 'twilio'

// S-10 PATCH: reconstruct the public URL from the forwarded headers Vercel
// injects, instead of trusting NEXT_PUBLIC_APP_URL. Twilio signs with the
// EXACT URL it called, so on preview deploys (*.vercel.app) the static env
// var diverges from the actual host and the signature check always fails.
// Mirrors the pattern already used by /api/webhooks/whatsapp.
function buildWebhookUrl(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host  = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  return `${proto}://${host}/api/webhooks/twilio`
}

// POST /api/webhooks/twilio
//
// Handles Twilio status callback webhooks (MessageStatus updates: sent, delivered, failed).
// Configure this URL in the Twilio console as the "Status Callback URL" for your messaging service.
//
// Security: validates the X-Twilio-Signature header using HMAC-SHA1 with TWILIO_AUTH_TOKEN.
// Any request that fails validation is rejected with 403.
export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN

  if (!authToken) {
    console.error('[webhooks/twilio] Missing TWILIO_AUTH_TOKEN')
    return new Response('Misconfigured', { status: 500 })
  }

  const signature  = req.headers.get('x-twilio-signature') ?? ''
  const webhookUrl = buildWebhookUrl(req)

  // Twilio sends application/x-www-form-urlencoded
  let params: Record<string, string> = {}
  try {
    const formData = await req.formData()
    formData.forEach((value, key) => {
      params[key] = String(value)
    })
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  // Validate signature — prevents spoofed webhook calls
  const isValid = validateRequest(authToken, signature, webhookUrl, params)
  if (!isValid) {
    console.warn('[webhooks/twilio] Invalid signature — request rejected')
    return new Response('Forbidden', { status: 403 })
  }

  const messageSid = params['MessageSid']    ?? 'unknown'
  const status     = params['MessageStatus'] ?? 'unknown'
  const to         = params['To']            ?? 'unknown'

  console.info(`[webhooks/twilio] ${messageSid} → ${status} (to: ${to})`)

  if (status === 'failed' || status === 'undelivered') {
    console.warn(`[webhooks/twilio] Delivery failure for ${messageSid} to ${to}`)
  }

  // Twilio expects a 200 response, otherwise it retries
  return new Response('OK', { status: 200 })
}
