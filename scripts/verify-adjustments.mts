import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { orderSummary, paymentOutstandingById, pendingOrderSummaries, toPaise } from '../src/lib/payment-settlement'
import { managementPaymentMetrics } from '../src/lib/management-payment-metrics'

const base = { customerName:'Acme', salesOrderId:'so-1', salesOrderNumber:'SO-1', orderTotal:10000, paymentAmount:0, paymentDate:'2026-10-01', createdAt:'2026-10-01T00:00:00Z' }
const receipt = { ...base, id:'receipt', paymentAmount:1000, status:'Payment Received' as const }
const writeoff = { ...base, id:'writeoff', entryType:'adjustment' as const, adjustmentAmount:-9000, adjustmentReason:'Written off', status:'Payment Received' as const, createdAt:'2026-10-02T00:00:00Z' }
const increase = { ...base, id:'increase', entryType:'adjustment' as const, adjustmentAmount:250.25, adjustmentReason:'Freight correction', status:'Payment Received' as const, createdAt:'2026-10-03T00:00:00Z' }

assert.equal(orderSummary([receipt], 'SO-1', 10000, 'so-1').confirmedOutstanding, 9000)
assert.equal(orderSummary([receipt, writeoff], 'SO-1', 10000, 'so-1').confirmedOutstanding, 0)
assert.equal(pendingOrderSummaries([receipt, writeoff]).length, 0, 'settled write-off must leave Pending Payments')
assert.equal(orderSummary([receipt, increase], 'SO-1', 10000, 'so-1').confirmedOutstanding, 9250.25)
assert.equal(toPaise(orderSummary([receipt, increase], 'SO-1', 10000, 'so-1').confirmedOutstanding!), 925025, 'rounding must stay in paise')
const balances=paymentOutstandingById([receipt,writeoff,increase])
assert.equal(balances.get('writeoff'),0)
assert.equal(balances.get('increase'),250.25)
assert.equal(orderSummary([receipt,{...writeoff,status:'Void'}], 'SO-1', 10000, 'so-1').confirmedOutstanding,9000,'void adjustments must not affect balance')
assert.equal(managementPaymentMetrics([receipt, increase], [])[0].amount, 1000, 'adjustments must not inflate cash received')

// Exercise the real durable local-store mutation in an isolated working directory.
const originalCwd = process.cwd()
const sandbox = await mkdtemp(path.join(tmpdir(), 'bsm-adjustment-'))
try {
  process.chdir(sandbox)
  process.env.APP_LOCAL_ONLY = 'true'
  const { createAdjustment, updatePaymentStatus } = await import('../src/lib/payments')
  const input = { customerName:'Acme', salesOrderId:'so-2', salesOrderNumber:'SO-2', orderTotal:100, adjustmentAmount:-10.25, adjustmentReason:'Audit correction', createdBy:'sales-1', ownerUserId:'sales-1', addedBy:'sales', salespersonName:'Sales Person' }
  const first = await createAdjustment(input, 'adjustment_key_123456')
  const retry = await createAdjustment(input, 'adjustment_key_123456')
  assert.equal(first.duplicate, false)
  assert.equal(retry.duplicate, true)
  assert.equal(retry.payment.id, first.payment.id, 'idempotent retry must return the durable row')
  assert.equal(first.payment.paymentAmount, 0)
  assert.equal(first.payment.status, 'Payment Received')
  assert.equal(first.payment.payoutSyncIntents, undefined, 'adjustment must not create payout intent')
  assert.equal(first.payment.audit?.[0]?.reason, input.adjustmentReason)
  const stored = JSON.parse(await readFile(path.join(sandbox, 'data/payments.json'), 'utf8'))
  assert.equal(stored.payments.length, 1, 'adjustment must be persisted exactly once')
  await assert.rejects(createAdjustment({...input, adjustmentAmount:-10.26}, 'adjustment_key_123456'), /different adjustment/)
  await assert.rejects(createAdjustment({...input, createdBy:'sales-2', ownerUserId:'sales-2'}, 'adjustment_key_123456'), /different adjustment/, 'idempotency keys must not cross actor or owner boundaries')
  await assert.rejects(updatePaymentStatus(first.payment.id, 'Void', 'admin'), /immutable/)
  await assert.rejects(createAdjustment({...input, adjustmentAmount:-100.01}, 'another_adjustment_key'), /cannot exceed/)
  await assert.rejects(readFile(path.join(sandbox, 'data/payments-payouts-outbox.json')), { code:'ENOENT' })
} finally {
  process.chdir(originalCwd)
  await rm(sandbox, { recursive:true, force:true })
}

const [routeSource, uiSource, cssSource] = await Promise.all([
  readFile(path.join(originalCwd, 'src/app/api/payments/adjustments/route.ts'), 'utf8'),
  readFile(path.join(originalCwd, 'src/components/PaymentsClient.tsx'), 'utf8'),
  readFile(path.join(originalCwd, 'src/app/globals.css'), 'utf8'),
])
assert.match(routeSource, /auth\.user\.role !== 'Admin' && !isSalesRole/, 'API must explicitly authorize only admin/sales roles')
assert.match(routeSource, /salespersonOwnsOrder\(order, auth\.user\)/, 'API must enforce salesperson ownership')
assert.match(uiSource, /payment-adjustment-row/, 'Regular Payments rows must mark adjustments')
assert.match(cssSource, /\.payment-adjustment-row>td\{background:#fff4f7/, 'adjustments must render pink')
console.log('Adjustment verification passed: persistence, authorization guards, ownership, signed paise arithmetic, idempotency, immutable/no-outbox behavior, cash exclusion, pending removal, and pink rendering')
