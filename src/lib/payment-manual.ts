import crypto from 'node:crypto'

const CUSTOMER_MAX = 120
function secret() {
  return process.env.PUBLIC_PAYMENT_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'bsm-public-payment-local-only'
}

/** Customer names are plain human-readable text, never markup or control data. */
export function cleanPaymentCustomerName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (!name || name.length > CUSTOMER_MAX || /[\u0000-\u001f\u007f-\u009f<>]/u.test(name)) return null
  return name
}

export function issuePaymentUploadScope(ttlMs = 20 * 60_000) {
  const scope = crypto.randomUUID()
  const payload = Buffer.from(JSON.stringify({ scope, exp: Date.now() + ttlMs })).toString('base64url')
  const signature = crypto.createHmac('sha256', secret()).update(`payment-upload:${payload}`).digest('base64url')
  return { scope, token: `${payload}.${signature}` }
}

export function verifyPaymentUploadScope(token: unknown): string | null {
  if (typeof token !== 'string') return null
  const [payload, supplied] = token.split('.')
  if (!payload || !supplied) return null
  const expected = crypto.createHmac('sha256', secret()).update(`payment-upload:${payload}`).digest('base64url')
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return null
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return parsed.exp > Date.now() && /^[0-9a-f-]{36}$/.test(parsed.scope) ? parsed.scope : null
  } catch { return null }
}
