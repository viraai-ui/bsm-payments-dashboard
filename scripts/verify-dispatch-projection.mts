import assert from 'node:assert/strict'
import test from 'node:test'
import { projectPaymentStatuses as project } from '../src/lib/payment-status-projection'
import { refreshProjection, type ProjectionState } from '../src/lib/payment-projection-cache'
const receipt = (extra = {}) => ({ id: 'r1', customerName: 'Not a match key', salesOrderId: '100', salesOrderNumber: 'SO-001', orderTotal: 100, paymentAmount: 100, status: 'Pending' as const, ...extra })
test('linked new payment, Pending → Received → Void; read only', () => {
  const rows = [receipt()], before = JSON.stringify(rows)
  assert.deepEqual(project(rows), { 'SO-001': 'Pending' }); assert.equal(JSON.stringify(rows), before)
  assert.equal(project([receipt({ status: 'Payment Received' })])['SO-001'], 'Received')
  assert.equal(project([receipt({ status: 'Void' })])['SO-001'], 'Void')
})
test('multiple receipts require cumulative confirmed settlement, not submitted amount', () => {
  const first = receipt({ paymentAmount: 40, status: 'Payment Received' })
  assert.equal(project([first])['SO-001'], 'Partial')
  assert.equal(project([first, receipt({ id: 'r2', paymentAmount: 60 })])['SO-001'], 'Partial')
  assert.equal(project([first, receipt({ id: 'r2', paymentAmount: 60, status: 'Payment Received' })])['SO-001'], 'Received')
  assert.equal(project([first, receipt({ id: 'r2', paymentAmount: 60, status: 'Void' })])['SO-001'], 'Partial')
  assert.equal(project([receipt({ orderTotal: undefined, status: 'Payment Received' })])['SO-001'], 'Partial')
})
test('split claims: never count unauthorised parent or void child', () => {
  const rows = [receipt({ id: 'parent', status: 'Unauthorised', originalPaymentAmount: 500 }), receipt({ parentPaymentId: 'parent', paymentAmount: 40, status: 'Payment Received' }), receipt({ id: 'r2', parentPaymentId: 'parent', paymentAmount: 60, status: 'Void' }), receipt({ id: 'r3', parentPaymentId: 'parent', salesOrderId: '200', salesOrderNumber: 'SO-002', status: 'Payment Received' })]
  assert.deepEqual(project(rows), { 'SO-001': 'Partial', 'SO-002': 'Received' })
})
test('exact SO/ID mapping preserves zeros/punctuation and rejects ambiguous IDs', () => {
  assert.deepEqual(project([receipt(), receipt({ salesOrderId: '200', salesOrderNumber: 'SO-1', status: 'Payment Received' }), receipt({ salesOrderId: '300', salesOrderNumber: 'SO001', status: 'Void' })]), { 'SO-001': 'Pending', 'SO-1': 'Received', SO001: 'Void' })
  assert.deepEqual(project([receipt(), receipt({ salesOrderId: 'other' })]), {})
  const snapshots = { '100': { salesOrderId: '100', salesOrderNumber: 'SO-001', orderTotal: 200, available: true } }
  assert.equal(project([receipt({ salesOrderNumber: undefined, status: 'Payment Received' })], snapshots)['SO-001'], 'Partial')
  assert.deepEqual(project([receipt({ salesOrderNumber: 'SO-999' })], snapshots), {})
})
function memory() {
  let state: ProjectionState | undefined, revision = 0
  return { read: async () => state ? { state: structuredClone(state), etag: String(revision) } : null, write: async (next: ProjectionState, etag?: string) => { if (etag !== (state ? String(revision) : undefined)) return false; state = structuredClone(next); revision++; return true } }
}
test('shared refresh collapses parallel callers, preserves last good offline, retries bounded, monotonic versions', async () => {
  const store = memory(); let calls = 0
  const generate = async () => { calls++; return { 'SO-001': 'Pending' as const } }
  const first = await refreshProjection(store, generate, 1_000)
  const concurrent = await Promise.all(Array.from({ length: 20 }, () => refreshProjection(store, generate, 20_000)))
  assert.equal(calls, 2); assert.equal(first.version, 1); assert.ok(concurrent.every(p => p.version >= 1))
  const latest = (await store.read())!.state.snapshot!
  const offline = async () => { calls++; throw new Error('offline') }
  assert.deepEqual(await refreshProjection(store, offline, 40_000), latest)
  await refreshProjection(store, offline, 41_000); assert.equal(calls, 3)
  const next = await refreshProjection(store, async () => ({ 'SO-001': 'Received' }), 71_000)
  assert.equal(next.version, 3); assert.equal(next.bySalesOrder['SO-001'], 'Received')
  assert.equal((await refreshProjection(store, async () => ({}), 90_000)).bySalesOrder['SO-001'], 'Received')
})
test('cold source failure is unavailable, never empty success', async () => {
  await assert.rejects(refreshProjection(memory(), async () => { throw new Error('offline') }, 1000), /unavailable/)
})
test('expired lease cannot publish over a newer successful generation', async () => {
  const store = memory(); await refreshProjection(store, async () => ({ 'SO-001': 'Pending' }), 1000)
  let unblock!: () => void
  const gate = new Promise<void>(resolve => { unblock = resolve })
  const old = refreshProjection(store, async () => { await gate; return { 'SO-001': 'Received' } }, 20_000)
  // Let the old worker acquire and reread its lease.
  await new Promise(resolve => setTimeout(resolve, 5))
  const fresh = await refreshProjection(store, async () => ({ 'SO-001': 'Void' }), 51_000)
  unblock(); const late = await old
  assert.deepEqual(late, fresh); assert.equal((await store.read())!.state.snapshot!.bySalesOrder['SO-001'], 'Void')
})
