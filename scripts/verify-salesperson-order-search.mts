import assert from 'node:assert/strict'
import { filterSalespersonOrders, orderMatchesSalesSearch } from '../src/lib/salesperson-order-search'
import type { OverviewOrder } from '../src/lib/salesperson-overview'

const order = (overrides: Partial<OverviewOrder> = {}): OverviewOrder => ({
  salesOrderId: '1', salesOrderNumber: 'SO-07987', customerName: 'Shri Balaji Enterprises - Bahadurgarh',
  orderDate: '2026-09-19', orderTotal: 2183910, received: 183910, outstanding: 2000000,
  currency: 'INR', status: 'PENDING', ...overrides,
})
const rows = [order(), order({ salesOrderId: '2', salesOrderNumber: 'SO-2', customerName: 'Other', status: 'RECEIVED' })]

for (const query of ['so 07987', 'SO-07987', 'balaji enterprises', '2026/09/19', '19 Sept 2026',
  '₹21,83,910', '183910', '20,00,000', 'pending', 'partial', 'partial payment']) {
  assert.equal(orderMatchesSalesSearch(rows[0], query), true, `expected match for ${query}`)
}
assert.equal(orderMatchesSalesSearch(rows[0], 'received'), false)
assert.deepEqual(filterSalespersonOrders(rows, ''), rows)
assert.deepEqual(filterSalespersonOrders(rows, 'so-2').map(row => row.salesOrderId), ['2'], 'filter preserves source order and scope')
assert.equal(filterSalespersonOrders(rows, 'does not exist').length, 0)
console.log('salesperson order search: fields, punctuation normalization, aliases, empty query and stable filtering passed')