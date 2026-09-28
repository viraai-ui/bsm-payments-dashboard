import { orderSummary, type SettlementPayment } from './payment-settlement'

export type ProjectedPaymentStatus = 'Pending' | 'Received' | 'Partial' | 'Void'
export function normalizeSalesOrderNumber(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFKC').trim().toUpperCase().replace(/\s+/g, ' ').replace(/\s*-\s*/g, '-') : ''
}
export type ProjectionSnapshot = { version: number; generatedAt: string; bySalesOrder: Record<string, ProjectedPaymentStatus> }
export type OrderSnapshot = { salesOrderId: string; salesOrderNumber: string; orderTotal: number; available: boolean }

/** Read-only settlement, never a receipt-status shortcut. Exact number groups are
 * isolated before invoking the canonical aggregate (whose legacy matcher is wider).
 * Unassigned parents cannot contribute money; only their linked children can.
 * Conflicting identities are omitted, never guessed from customer names. */
export function projectPaymentStatuses(payments: readonly SettlementPayment[], snapshots: Record<string, OrderSnapshot> = {}): Record<string, ProjectedPaymentStatus> {
  const groups = new Map<string, SettlementPayment[]>()
  for (const payment of payments) {
    const byId = payment.salesOrderId ? snapshots[payment.salesOrderId] : undefined
    const key = normalizeSalesOrderNumber(payment.salesOrderNumber || (byId?.available ? byId.salesOrderNumber : ''))
    if (!key || payment.status === 'Unauthorised' || payment.originalPaymentAmount !== undefined) continue
    if (byId?.available && normalizeSalesOrderNumber(byId.salesOrderNumber) !== key) continue
    groups.set(key, [...(groups.get(key) || []), { ...payment, salesOrderNumber: key }])
  }
  const result: Record<string, ProjectedPaymentStatus> = {}
  for (const [number, linked] of groups) {
    const ids = new Set(linked.map(p => p.salesOrderId).filter(Boolean))
    if (ids.size > 1) continue
    const candidates = Object.values(snapshots).filter(s => s.available && normalizeSalesOrderNumber(s.salesOrderNumber) === number)
    if (candidates.length > 1 || candidates.some(s => ids.size && !ids.has(s.salesOrderId))) continue
    const summary = orderSummary(linked, number, candidates[0]?.orderTotal)
    // Missing/non-finite totals must never imply full settlement.
    result[number] = linked.every(p => p.status === 'Void') ? 'Void'
      : summary.settled && Number.isFinite(summary.orderTotal) ? 'Received'
      : summary.confirmedReceived > 0 ? 'Partial' : 'Pending'
  }
  return result
}
