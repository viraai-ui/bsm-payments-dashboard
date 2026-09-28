import { timingSafeEqual } from 'node:crypto'
import { requireUser } from '@/lib/auth'
import { readAuthoritativeJson } from '@/lib/local-store'
import { projectPaymentStatuses, type OrderSnapshot } from '@/lib/payment-status-projection'
import { refreshProjection, type ProjectionState } from '@/lib/payment-projection-cache'
import type { SettlementPayment } from '@/lib/payment-settlement'
import { getR2Object, putR2Object } from '@/lib/r2'

export const dynamic = 'force-dynamic'
const KEY = 'app-data/payments-dashboard/dispatch-payment-projection.json'
const headers = { 'cache-control': 'private, no-store' }
function authorized(request: Request) {
  const secret = process.env.DISPATCH_PAYMENT_PROJECTION_SECRET?.trim()
  const supplied = request.headers.get('authorization') || ''
  if (!secret || secret.length < 32) return false
  const expected = Buffer.from(`Bearer ${secret}`), actual = Buffer.from(supplied)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
export async function GET(request: Request) {
  if (!authorized(request)) {
    // A malformed bearer never falls back to session authentication.
    if (request.headers.has('authorization')) return Response.json({ error: 'Unauthorized' }, { status: 401, headers })
    const auth = await requireUser(['Admin'])
    if (!auth.ok) { auth.response.headers.set('cache-control', 'no-store'); return auth.response }
  }
  try {
    const snapshot = await refreshProjection({
      async read() {
        const object = await getR2Object(KEY)
        if (!object) return null
        if (!object.etag) throw new Error('Missing projection ETag')
        return { state: JSON.parse(object.bytes.toString()) as ProjectionState, etag: object.etag }
      },
      write: (state, etag) => putR2Object(KEY, 'application/json', Buffer.from(JSON.stringify(state)), etag ? { etag } : { createOnly: true }),
    }, async () => {
      const [ledger, orders] = await Promise.all([
        readAuthoritativeJson<{ payments: SettlementPayment[] } | null>('payments.json', null),
        readAuthoritativeJson<{ orders: Record<string, OrderSnapshot> } | null>('sales-order-snapshots.json', null),
      ])
      if (!ledger || !Array.isArray(ledger.payments) || !orders?.orders) throw new Error('Missing authoritative source')
      return projectPaymentStatuses(ledger.payments, orders.orders)
    })
    return Response.json(snapshot, { headers })
  } catch {
    return Response.json({ error: 'Payment projection temporarily unavailable' }, { status: 503, headers })
  }
}
