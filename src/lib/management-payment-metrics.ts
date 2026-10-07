import type { SettlementPayment } from './payment-settlement'
import { toPaise, fromPaise, soPaymentAmount } from './payment-settlement'

export type ManagementPaymentMetric = {
  key: 'received' | 'pending-receipts' | 'unauthorised' | 'pending-payments'
  label: 'Payment Received' | 'Payment Pending' | 'Unauthorised Payments' | 'Pending Payments'
  amount: number
}

export type OutstandingOrder = { outstanding?: number }

/** Computes receipt workflow totals from the server-scoped payment payload and
 * the order-balance headline from the exact server-authoritative collection that
 * renders the Pending Payments tab. These are intentionally separate concepts. */
export function managementPaymentMetrics(
  payments: SettlementPayment[],
  outstandingOrders: OutstandingOrder[],
): ManagementPaymentMetric[] {
  // Allocation parents are immutable source receipts, not extra payments.
  const accountingAmount = (payment: SettlementPayment) => payment.originalPaymentAmount !== undefined
    ? (payment.remainingAmount ?? payment.paymentAmount)
    : (payment.salesOrderId ? soPaymentAmount(payment) : payment.paymentAmount)
  const sum = (status: SettlementPayment['status']) => fromPaise(payments
    .filter(payment => payment.status === status)
    .reduce((total, payment) => total + toPaise(accountingAmount(payment)), 0))
  const outstanding = fromPaise(outstandingOrders.reduce((total, order) => {
    const paise = toPaise(order.outstanding ?? 0)
    return total + (Number.isSafeInteger(paise) && paise > 0 ? paise : 0)
  }, 0))
  return [
    { key: 'received', label: 'Payment Received', amount: sum('Payment Received') },
    { key: 'pending-receipts', label: 'Payment Pending', amount: sum('Pending') },
    { key: 'unauthorised', label: 'Unauthorised Payments', amount: sum('Unauthorised') },
    { key: 'pending-payments', label: 'Pending Payments', amount: outstanding },
  ]
}
