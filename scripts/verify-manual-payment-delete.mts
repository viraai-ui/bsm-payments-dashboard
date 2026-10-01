import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.APP_LOCAL_ONLY = 'true'
const cwd = process.cwd()
const source = await readFile(path.join(cwd, 'src/components/PaymentsClient.tsx'), 'utf8')
process.chdir(await mkdtemp(path.join(tmpdir(), 'manual-payment-delete-')))

const { canDeletePayment, createUnlinkedPayment, deletePaymentWithTombstone, listPayments, paymentReadModelForUserFresh } = await import('../src/lib/payments.ts')
const sonia = { id: 'u-sonia', name: 'Sonia', email: 'sonia@example.com', username: 'sonia', role: 'Spare Part Sales', active: true, createdAt: '', updatedAt: '' } as any
const other = { ...sonia, id: 'u-other', name: 'Other', username: 'other' }
const make = (overrides: Record<string, unknown> = {}) => createUnlinkedPayment({
  customerName: 'Walk-in customer', manualReference: 'MANUAL-REF', paymentAmount: 1250,
  paymentMode: 'UPI', status: 'Pending', createdBy: sonia.id, ownerUserId: sonia.id,
  addedBy: sonia.username, salespersonName: sonia.name, ...overrides,
} as any, crypto.randomUUID())

const { payment } = await make()
assert.ok(canDeletePayment(payment, sonia), 'Sonia can delete her own pending manual receipt')
assert.equal(canDeletePayment(payment, other), false, 'another salesperson cannot delete Sonia’s receipt')
assert.equal(canDeletePayment({ ...payment, status: 'Payment Received' }, sonia), false, 'received receipts remain immutable')
assert.equal(canDeletePayment({ ...payment, status: 'Void' }, sonia), false, 'void receipts remain immutable')

await assert.rejects(() => deletePaymentWithTombstone(payment.id, other, 'not mine'), /cannot delete/)
assert.ok((await listPayments()).some(p => p.id === payment.id), 'a rejected delete leaves the receipt intact')
await deletePaymentWithTombstone(payment.id, sonia, 'entered in error')
assert.equal((await listPayments()).some(p => p.id === payment.id), false, 'authorized delete removes the active receipt')
for (let poll = 0; poll < 3; poll++) {
  const readModel = await paymentReadModelForUserFresh(sonia)
  assert.equal(readModel.payments.some(p => p.id === payment.id), false, `production-shaped fresh poll ${poll + 1} cannot resurrect the deleted receipt`)
}
const tombstones = JSON.parse(await readFile('data/payment-tombstones.json', 'utf8')).tombstones
assert.equal(tombstones[0].payment.id, payment.id, 'delete preserves an audit tombstone')
assert.equal(tombstones[0].actor, sonia.id)
assert.equal(tombstones[0].reason, 'entered in error')

assert.match(source, /role === "Salesperson" \|\| role === "Spare Part Sales"/, 'the overflow gate includes Spare Part Sales')
assert.match(source, /<Overflow p=\{p\} role=\{role\} userId=\{userId\}/, 'payment details exposes the same overflow actions')
assert.match(source, /onDelete=\{\(\) => \{ setSelected\(null\); setDeleting\(selected\); \}\}/, 'details delete opens the confirmation flow')
assert.match(source, /await refresh\(\);/, 'successful deletion refreshes the payment projection')

process.chdir(cwd)
console.log('PASS Sonia can delete her own pending manual payment from list/details UI while ownership and immutable-state rules remain enforced')
