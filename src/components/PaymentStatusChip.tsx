import type { ProjectedPaymentStatus } from '@/lib/payment-status-projection'

export function PaymentStatusChip({ status, className = '' }: { status?: ProjectedPaymentStatus; className?: string }) {
  if (!status) return null
  return <span className={`payment-projection-chip ${status === 'Received' ? 'received' : 'pending'} ${className}`.trim()} title="Payment status applies to the sales order"><i aria-hidden="true" />{status}</span>
}
