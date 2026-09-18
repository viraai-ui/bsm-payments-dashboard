import type { SettlementPayment } from './payment-settlement'
import { toPaise, fromPaise } from './payment-settlement'

export type ManagementPaymentMetric = {
  key: 'received' | 'pending-receipts' | 'unauthorised' | 'pending-payments'
  label: 'Payment Received' | 'Pending Receipts' | 'Unauthorised Payments' | 'Pending Payments'
  amount: number
}

/** Computes management totals from the already server-scoped payment payload.
 * Outstanding is calculated once per immutable SO id (SO number is the legacy
 * fallback), and only Pending/Received receipts reduce its authoritative total.
 */
export function managementPaymentMetrics(payments: SettlementPayment[]): ManagementPaymentMetric[] {
  const sum = (status: SettlementPayment['status']) => fromPaise(payments
    .filter(payment => payment.status === status)
    .reduce((total, payment) => total + toPaise(payment.paymentAmount), 0))
  const orders = new Map<string, { total: number; receipts: number }>()
  for (const payment of payments) {
    if ((!payment.salesOrderId && !payment.salesOrderNumber) || payment.orderTotal === undefined) continue
    // SO number keeps legacy rows (which predate salesOrderId) in the same order;
    // immutable id remains the fallback for unusual records without a number.
    const normalizedNumber = payment.salesOrderNumber?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    const key = normalizedNumber ? `so:${normalizedNumber}` : `id:${payment.salesOrderId}`
    const current = orders.get(key) || { total: toPaise(payment.orderTotal), receipts: 0 }
    // A newer authoritative total can safely replace a stale persisted total.
    current.total = toPaise(payment.orderTotal)
    if (payment.status === 'Pending' || payment.status === 'Payment Received') current.receipts += toPaise(payment.paymentAmount)
    orders.set(key, current)
  }
  const outstanding = fromPaise([...orders.values()].reduce((total, order) => total + Math.max(0, order.total - order.receipts), 0))
  return [
    { key: 'received', label: 'Payment Received', amount: sum('Payment Received') },
    { key: 'pending-receipts', label: 'Pending Receipts', amount: sum('Pending') },
    { key: 'unauthorised', label: 'Unauthorised Payments', amount: sum('Unauthorised') },
    { key: 'pending-payments', label: 'Pending Payments', amount: outstanding },
  ]
}
