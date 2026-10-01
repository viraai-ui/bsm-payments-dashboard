import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.APP_LOCAL_ONLY = 'true'
const cwd = process.cwd()
process.chdir(await mkdtemp(path.join(tmpdir(), 'manual-payment-')))

const { createUnlinkedPayment, isPaymentOwnedBy, listPayments, listPaymentsForUserFresh, normalizeSoniaLegacyManualPayment, pendingOrdersForUser } = await import('../src/lib/payments.ts')
const { applySalesOrderSnapshots } = await import('../src/lib/sales-order-reconciliation.ts')
const { paymentMatchesSearch } = await import('../src/lib/payment-settlement.ts')
const { selectSalespersonOverview } = await import('../src/lib/salesperson-overview.ts')
const { defaultManualPaymentEntry } = await import('../src/lib/payment-entry-mode.ts')

const sonia = { id: 'u-sonia', name: 'Sonia', email: 'sonia@example.com', username: 'sonia', role: 'Spare Part Sales', active: true, createdAt: '', updatedAt: '' } as any
const { payment } = await createUnlinkedPayment({
  customerName: 'Walk-in customer', manualReference: 'SO-EXAMPLE', paymentAmount: 1250,
  paymentMode: 'UPI', status: 'Pending', createdBy: sonia.id, ownerUserId: sonia.id,
  addedBy: sonia.username, salespersonName: sonia.name,
}, 'manual-payment-regression-key')

const durable = JSON.parse(await readFile('data/payments.json', 'utf8')).payments[0]
assert.equal(durable.manualReference, 'SO-EXAMPLE', 'manual reference survives the durable write')
assert.equal(durable.salesOrderId, undefined)
assert.equal(durable.salesOrderNumber, undefined, 'manual reference must not masquerade as an order number')
assert.ok(isPaymentOwnedBy(durable, sonia), 'fresh owner filtering keeps Sonia’s manual payment visible')

const snapshot: any = { salesOrderId: '123', salesOrderNumber: 'SO-EXAMPLE', customerName: 'Different ERP customer', orderTotal: 5000, orderDate: '2026-09-01', rawStatus: 'confirmed', currency: 'INR', modifiedTime: '', syncedAt: '', version: 1, available: true, audit: [] }
const projected = applySalesOrderSnapshots([payment], { '123': snapshot })[0]
assert.equal(projected.salesOrderId, undefined, 'a same-text ERP order cannot capture a manual payment during refresh')
assert.equal(projected.customerName, 'Walk-in customer')
assert.equal(pendingOrdersForUser([projected], sonia).length, 0, 'manual payments do not enter pending order coverage')

const { payment: malformedLegacy } = await createUnlinkedPayment({
  customerName: 'Legacy walk-in customer', salesOrderNumber: 'FREE TEXT SONIA REF', paymentAmount: 725,
  paymentMode: 'Cash', status: 'Pending', createdBy: 'u-sonia', ownerUserId: 'u-sonia',
  addedBy: 'sonia', salespersonName: 'Sonia',
}, 'legacy-malformed-sonia-key')
const legacyProjection = normalizeSoniaLegacyManualPayment(malformedLegacy)
assert.equal(legacyProjection.manualReference, 'FREE TEXT SONIA REF')
assert.equal(legacyProjection.salesOrderNumber, undefined, 'legacy free text is cleared before order projections')
assert.equal((await listPayments()).find(p => p.id === malformedLegacy.id)?.manualReference, 'FREE TEXT SONIA REF', 'normal reads normalize the legacy row')
const freshLegacy = (await listPaymentsForUserFresh(sonia)).find(p => p.id === malformedLegacy.id)
assert.ok(freshLegacy, 'fresh owner filtering keeps the malformed legacy row visible to Sonia')
assert.equal(freshLegacy?.salesOrderNumber, undefined, 'fresh reads normalize before snapshots')
assert.equal(freshLegacy?.manualReference, 'FREE TEXT SONIA REF')
assert.ok(paymentMatchesSearch(freshLegacy!, 'sonia ref', [freshLegacy!]), 'legacy manual reference remains searchable')
const legacySnapshot: any = { ...snapshot, salesOrderId: '456', salesOrderNumber: 'FREE TEXT SONIA REF' }
const legacyAfterSnapshot = applySalesOrderSnapshots([legacyProjection], { '456': legacySnapshot })[0]
assert.equal(legacyAfterSnapshot.salesOrderId, undefined, 'a matching ERP number cannot capture the legacy manual row')
assert.equal(pendingOrdersForUser([legacyAfterSnapshot], sonia).length, 0, 'legacy manual row stays out of Pending Orders')
assert.equal(selectSalespersonOverview([{ ...legacySnapshot, id: '456', salespersonName: 'Other Person' }], [legacyAfterSnapshot], sonia, { lastSyncedAt: '', recencyVerifiedAt: '' }).orders.length, 0, 'legacy manual row stays out of Overview')
assert.equal(normalizeSoniaLegacyManualPayment({ ...malformedLegacy, salesOrderId: 'real-id' }).salesOrderNumber, 'FREE TEXT SONIA REF', 'real linked rows are never rewritten')
assert.equal(normalizeSoniaLegacyManualPayment({ ...malformedLegacy, ownerUserId: 'u-other' }).salesOrderNumber, 'FREE TEXT SONIA REF', 'other owners are never rewritten')

const overview = selectSalespersonOverview([{ id: '123', salesOrderNumber: 'SO-EXAMPLE', customerName: 'Different ERP customer', status: 'confirmed', orderDate: '2026-09-01', orderTotal: 5000, currency: 'INR', modifiedTime: '', salespersonName: 'Other Person' }], [projected], sonia, { lastSyncedAt: '', recencyVerifiedAt: '' })
assert.equal(overview.orders.length, 0, 'manual payments do not create Overview sales-order rows')
assert.equal(defaultManualPaymentEntry('Spare Part Sales'), true)
assert.equal(defaultManualPaymentEntry('Spare Part Sales', 'SO-1'), false, 'order deep-links remain linked mode')
assert.equal(defaultManualPaymentEntry('Salesperson'), false, 'other roles preserve linked default')

process.chdir(cwd)
console.log('PASS new and Sonia legacy manual payments remain visible, searchable by reference, and excluded from order projections')
