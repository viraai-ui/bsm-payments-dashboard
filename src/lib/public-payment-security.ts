import crypto from 'node:crypto'

const WINDOW_MS = 60_000
const buckets = new Map<string, { count: number; reset: number }>()

function secret() {
  return process.env.PUBLIC_PAYMENT_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'bsm-public-payment-local-only'
}

export function clientIp(request: Request) {
  return (request.headers.get('x-forwarded-for')?.split(',')[0] || request.headers.get('x-real-ip') || 'unknown').trim().slice(0, 64)
}

export function checkRateLimit(request: Request, scope: string, limit: number) {
  const now = Date.now()
  const key = `${scope}:${clientIp(request)}`
  const current = buckets.get(key)
  const bucket = !current || current.reset <= now ? { count: 0, reset: now + WINDOW_MS } : current
  bucket.count += 1
  buckets.set(key, bucket)
  if (buckets.size > 2000) for (const [item, value] of buckets) if (value.reset <= now) buckets.delete(item)
  return { allowed: bucket.count <= limit, retryAfter: Math.max(1, Math.ceil((bucket.reset - now) / 1000)) }
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return true // Native/webview clients commonly omit Origin; token remains mandatory.
  const expected = new URL(request.url).origin
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
  return origin === expected || Boolean(configured && origin === configured)
}

export function strictSameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return false
  const expected = new URL(request.url).origin
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
  return origin === expected || Boolean(configured && origin === configured)
}

export function issueSubmissionToken(ttlMs = 10 * 60_000) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + ttlMs, nonce: crypto.randomUUID() })).toString('base64url')
  const signature = crypto.createHmac('sha256', secret()).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export function verifySubmissionToken(token: string) {
  const [payload, supplied] = token.split('.')
  if (!payload || !supplied) return false
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url')
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return false
  try { return Number(JSON.parse(Buffer.from(payload, 'base64url').toString()).exp) > Date.now() } catch { return false }
}

/** A deletion capability is deliberately unrelated to the short-lived form token. */
export function issuePaymentDeleteCapability() {
  const token = crypto.randomBytes(32).toString('base64url')
  return { token, hash: hashPaymentDeleteCapability(token) }
}

export function hashPaymentDeleteCapability(token: string) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex')
}

export function verifyPaymentDeleteCapability(token: string, storedHash?: string) {
  if (!token || !storedHash || !/^[a-f0-9]{64}$/.test(storedHash)) return false
  const supplied = Buffer.from(hashPaymentDeleteCapability(token), 'hex')
  const expected = Buffer.from(storedHash, 'hex')
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)
}

export function publicApiHeaders(response: Response) {
  response.headers.set('Cache-Control', 'no-store, max-age=0')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'same-origin')
  return response
}
