import { timingSafeEqual } from 'node:crypto'
import { requireUser } from '@/lib/auth'
import { readAuthoritativeJson } from '@/lib/local-store'
import { projectPaymentStatuses, type OrderSnapshot } from '@/lib/payment-status-projection'
import { refreshProjection, type ProjectionState } from '@/lib/payment-projection-cache'
import type { SettlementPayment } from '@/lib/payment-settlement'
import { getR2Object, putR2Object, r2Configured } from '@/lib/r2'
import { getGitHubDataObject, putGitHubDataObject } from '@/lib/github-data-store'

export const dynamic = 'force-dynamic'
const KEY = 'app-data/payments-dashboard/dispatch-payment-projection.json'
const headers = { 'cache-control': 'private, no-store' }
let cached: { snapshot: NonNullable<ProjectionState['snapshot']>; until: number } | undefined
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
    if (cached && cached.until > Date.now()) return Response.json(cached.snapshot, { headers })
    const r2 = r2Configured()
    const snapshot = await refreshProjection({
      async read() {
        const object = r2 ? await getR2Object(KEY) : await getGitHubDataObject('data/dispatch-payment-projection.json')
        if (!object) return null
        const etag = 'sha' in object ? object.sha : object.etag
        if (!etag) throw new Error('Missing projection revision')
        return { state: JSON.parse(object.bytes.toString()) as ProjectionState, etag }
      },
      write: (state, etag) => {
        // Dedicated data repository only: never causes an application deploy.
        // GitHub needs a slower shared cadence than object storage.
        if (!state.lease) state.nextRefreshAt = Date.now() + (r2 ? 15_000 : 60_000)
        const bytes = Buffer.from(JSON.stringify(state))
        return r2 ? putR2Object(KEY, 'application/json', bytes, etag ? { etag } : { createOnly: true })
          : putGitHubDataObject('data/dispatch-payment-projection.json', bytes, 'Refresh read-only Dispatch payment projection', etag)
      },
    }, async () => {
      const [ledger, orders] = await Promise.all([
        readAuthoritativeJson<{ payments: SettlementPayment[] } | null>('payments.json', null),
        readAuthoritativeJson<{ orders: Record<string, OrderSnapshot> } | null>('sales-order-snapshots.json', null),
      ])
      if (!ledger || !Array.isArray(ledger.payments) || !orders?.orders) throw new Error('Missing authoritative source')
      return projectPaymentStatuses(ledger.payments, orders.orders)
    })
    cached = { snapshot, until: Date.now() + 15_000 }
    return Response.json(snapshot, { headers })
  } catch {
    return Response.json({ error: 'Payment projection temporarily unavailable' }, { status: 503, headers })
  }
}
