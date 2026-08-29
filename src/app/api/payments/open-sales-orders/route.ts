import { apiError, apiOk } from '@/lib/api'
import { requireUser } from '@/lib/auth'
import { refreshPaymentOrderIndex, searchPaymentOrders } from '@/lib/payment-order-search'

export async function GET(request: Request) {
  const auth = await requireUser(['Admin', 'Accounts'])
  if (!auth.ok) return auth.response
  try {
    const url = new URL(request.url)
    const refresh = url.searchParams.get('refresh') === '1'
    if (refresh) await refreshPaymentOrderIndex(true)
    const q = String(url.searchParams.get('q') || '').slice(0, 100)
    const result = await searchPaymentOrders(q, Math.min(Number(url.searchParams.get('limit')) || (q ? 25 : 10), 50))
    return apiOk({ source: 'payment_order_index', ...result })
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Could not load open sales orders', 502)
  }
}