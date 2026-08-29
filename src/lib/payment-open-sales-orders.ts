import type { Order } from '@/types/domain'
import { fetchZohoPaymentOpenOrders } from './zoho'
import { paymentOrderStatus, type PaymentOrderDisplayStatus } from './payment-order-lookup'

export type PaymentOrderSuggestion = Pick<Order, 'id' | 'salesOrderNumber' | 'customerName'> & { status: PaymentOrderDisplayStatus; rawStatus: string }

export function toPaymentOrderSuggestions(orders: Order[]): PaymentOrderSuggestion[] {
  return orders.filter((order) => Boolean(order?.id && order.salesOrderNumber) && !String(order.id).startsWith('manual-serial-') && !String(order.salesOrderNumber).startsWith('SERIAL-'))
    .map(({ id, salesOrderNumber, customerName, status }) => ({ id, salesOrderNumber, customerName, rawStatus: String(status || ''), status: paymentOrderStatus(status) }))
}

/** Complete, read-only payment lookup; never reads or writes operational workflow state. */
export async function listPaymentOpenSalesOrders(refresh = false) {
  // Legacy export name is retained for route compatibility. The operational
  // synced store intentionally excludes terminal orders, so payment lookup must
  // use Zoho's complete newest-first feed.
  void refresh
  return toPaymentOrderSuggestions(await fetchZohoPaymentOpenOrders())
}
