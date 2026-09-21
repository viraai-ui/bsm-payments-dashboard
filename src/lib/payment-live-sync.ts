import type { Payment } from './payments'

/** Keep authoritative mutation results while merging a polling snapshot. */
export function mergePaymentSnapshot(current: readonly Payment[], incoming: readonly Payment[], mutatingIds: ReadonlySet<string>) {
  const protectedPayments = new Map(current.filter(payment => mutatingIds.has(payment.id)).map(payment => [payment.id, payment]))
  const merged = incoming.map(payment => protectedPayments.get(payment.id) || payment)
  for (const payment of protectedPayments.values()) if (!merged.some(item => item.id === payment.id)) merged.push(payment)
  return merged
}