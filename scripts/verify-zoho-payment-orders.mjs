import assert from 'node:assert/strict'
import { fetchAllZohoPaymentOrders, resetZohoPaymentOrdersForTests } from '../src/lib/zoho-payment-orders.ts'
import { paymentOrderStatus, filterPaymentOrderSuggestions } from '../src/lib/payment-order-lookup.ts'

Object.assign(process.env, { ZOHO_CLIENT_ID: 'test-client', ZOHO_CLIENT_SECRET: 'test-secret', ZOHO_REFRESH_TOKEN: 'test-refresh', ZOHO_ORGANIZATION_ID: 'test-org', ZOHO_DC: 'in' })
const statuses = ['draft', 'open', 'overdue', 'partially_invoiced', 'invoiced', 'closed', 'void', 'cancelled']
const row = (i, status = statuses[i % statuses.length]) => ({ salesorder_id: `id-${i}`, salesorder_number: `SO-${String(i).padStart(5, '0')}`, customer_name: `Customer ${i}`, total: i + .5, date: `2026-09-${String(1 + i % 15).padStart(2, '0')}`, status, currency_code: 'INR' })
let tokenCalls = 0, listCalls = 0
const mockedFetch = async (input, init = {}) => {
  const url = String(input)
  if (url.includes('/oauth/v2/token')) { tokenCalls++; return Response.json({ access_token: `token-${tokenCalls}`, expires_in: 3600 }) }
  listCalls++
  const page = Number(new URL(url).searchParams.get('page'))
  assert.equal(new URL(url).searchParams.has('filter_by'), false, 'must not status-filter Zoho')
  if (listCalls === 1) return Response.json({ message: 'expired' }, { status: 401 })
  if (page === 1) return Response.json({ salesorders: Array.from({ length: 200 }, (_, i) => row(i)), page_context: { page: 1, has_more_page: true } })
  return Response.json({ salesorders: [row(200), row(201), row(10, 'closed')], page_context: { page: 2, has_more_page: false } })
}
resetZohoPaymentOrdersForTests()
const orders = await fetchAllZohoPaymentOrders(mockedFetch)
assert.equal(orders.length, 202, 'multi-page results are complete and deduplicated by salesorder_id')
assert.equal(tokenCalls, 2, '401 refreshes the access token exactly once')
for (const status of statuses) assert.ok(orders.some(o => o.rawStatus === status), `retains ${status}`)
assert.ok(orders.some(o => o.rawStatus === 'closed'), 'closed orders are never excluded')
assert.notEqual(paymentOrderStatus('not_invoiced'), 'Closed')
assert.equal(paymentOrderStatus('partially_invoiced'), 'Open')
assert.equal(paymentOrderStatus('closed'), 'Closed')
assert.ok(orders.every(o => o.currency === 'INR' && typeof o.orderTotal === 'number' && o.orderDate))
const searchable = orders.map(o => ({ ...o, status: paymentOrderStatus(o.rawStatus) }))
assert.ok(filterPaymentOrderSuggestions(searchable, '2', 50).length > 0, 'one-character SO search works')
assert.ok(filterPaymentOrderSuggestions(searchable, 'Customer 1', 50).length > 0, 'customer search works')
resetZohoPaymentOrdersForTests()
await assert.rejects(() => fetchAllZohoPaymentOrders(async () => Response.json({ error: 'invalid_client' }, { status: 400 })), /invalid_client/, 'token errors surface safely')
console.log(`Zoho payment lookup verified: ${orders.length} unique orders, ${listCalls} list calls, all statuses retained`)
