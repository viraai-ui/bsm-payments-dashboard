import { apiError, apiOk } from '@/lib/api'
import { searchPaymentOrders } from '@/lib/payment-order-search'
import { checkRateLimit, issueSubmissionToken, publicApiHeaders } from '@/lib/public-payment-security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const rate = await checkRateLimit(request, 'public-payment-orders', 30)
  if (!rate.allowed) {
    const response = apiError('Too many requests. Please try again shortly.', 429)
    response.headers.set('Retry-After', String(rate.retryAfter))
    return publicApiHeaders(response)
  }
  try {
    // Deliberately uses only the dedicated read-only payment lookup; no state is persisted.
    const url = new URL(request.url)
    const q = String(url.searchParams.get('q') || '').slice(0, 100)
    const limit = Math.min(Number(url.searchParams.get('limit')) || (q ? 25 : 10), 50)
    const result = await searchPaymentOrders(q, limit)
    const response = apiOk({ ...result, submissionToken: issueSubmissionToken() })
    response.headers.set('Server-Timing', `search;dur=${result.searchMs.toFixed(2)}`)
    response.headers.set('X-Payment-Order-Cache', result.stale ? 'STALE' : 'HIT')
    response.headers.set('Cache-Control', 'private, no-store, max-age=0')
    return publicApiHeaders(response)
  } catch (error) {
    console.error('Could not load public sales orders',error)
    return publicApiHeaders(apiError('Could not load sales orders', 502))
  }
}
