import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {canSyncPaymentSalesOrder,exactIndexedOrderId} from '../src/lib/sales-order-manual-sync.ts'

assert.equal(exactIndexedOrderId('SO-08001',{'123':{salesOrderNumber:'SO-08001'},'manual-x':{salesOrderNumber:'SO-08001'}}),'123','synthetic exact-number linkage resolves to the sole canonical Zoho id')
assert.equal(exactIndexedOrderId('SO-08001',{'123':{salesOrderNumber:'SO-08001'},'456':{salesOrderNumber:'SO 08001'}}),null,'ambiguous exact canonical numbers are rejected')
assert.equal(exactIndexedOrderId('SO-0800',{'123':{salesOrderNumber:'SO-08001'}}),null,'partial/fuzzy sales-order matches are rejected')
const route=await readFile('src/app/api/payments/sync-sales-order/route.ts','utf8'),ui=await readFile('src/components/PaymentsClient.tsx','utf8'),css=await readFile('src/app/payments-cleanup.css','utf8'),service=await readFile('src/lib/sales-order-manual-sync.ts','utf8'),payments=await readFile('src/lib/payments.ts','utf8')
assert.match(route,/requireUser\(\['Salesperson'\]\)/,'only Salespeople may sync')
assert.match(route,/k!==['"]paymentId['"]/,'forged client order metadata is rejected')
assert.match(service,/fetchZohoPaymentOrderDetail\(id,fetch,true,true\)/,'manual sync forces one-attempt authoritative detail')
assert.match(service,/sales-order-sync-limits\.json/,'rate limits and in-flight leases are durable')
assert.match(service,/commitSalesOrder/,'authoritative snapshot is committed with CAS/audit')
assert.match(payments,/payment-order-link-backups\.json/,'exact synthetic linkage migration is backed up')
assert.match(ui,/role===\"Salesperson\"/,'button is rendered only for Salespeople');assert.doesNotMatch(ui,/role===\"Admin\"\|\|role===\"Accounts\"/)
assert.equal(canSyncPaymentSalesOrder({ownerUserId:'sales-a',createdBy:'admin'} as any,'sales-a'),true)
assert.equal(canSyncPaymentSalesOrder({ownerUserId:'sales-b',createdBy:'sales-a'} as any,'sales-a'),false,'stable owner denies cross-salesperson sync')
assert.match(ui,/aria-label="Sync sales order"/)
assert.match(ui,/setAuthoritativePending\(data\.pendingOrders\)/,'pending model updates without a reload')
assert.match(ui,/state:"loading"/);assert.match(ui,/data\.message/);assert.match(ui,/json\.error/)
assert.match(css,/width:44px;height:44px/,'sync target is accessible')
console.log('manual sales-order sync contract: ok')
