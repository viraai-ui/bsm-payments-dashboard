export type ProjectedPaymentStatus = 'Pending' | 'Received'

export type PaymentStatusProjectionInput = {
  salesOrderNumber?: unknown
  status?: unknown
}

/** Conservative identity normalization: no numeric coercion and no punctuation loss. */
export function normalizeSalesOrderNumber(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.normalize('NFKC').trim().toUpperCase().replace(/\s+/g, ' ').replace(/\s*-\s*/g, '-')
}

/** Unknown/malformed statuses are treated as pending so they can never imply receipt. */
export function projectPaymentStatuses(payments: readonly PaymentStatusProjectionInput[]): Record<string, ProjectedPaymentStatus> {
  const grouped = new Map<string, ProjectedPaymentStatus>()
  for (const payment of payments) {
    const key = normalizeSalesOrderNumber(payment.salesOrderNumber)
    if (!key) continue
    const status: ProjectedPaymentStatus = payment.status === 'Payment Received' ? 'Received' : 'Pending'
    if (grouped.get(key) !== 'Pending') grouped.set(key, status)
  }
  return Object.fromEntries(grouped)
}
