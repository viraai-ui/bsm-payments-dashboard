import type { Order } from '@/types/domain'

const TERMINAL_STATUS_WORDS = ['closed', 'void', 'cancelled', 'canceled', 'shipped', 'invoiced']

/** Payment suggestions are limited to genuine, non-terminal Zoho sales orders. */
export function isOpenZohoSalesOrder(order: Pick<Order, 'id' | 'salesOrderNumber' | 'status'> | null | undefined) {
  if (!order) return false
  const status = String(order.status || '').trim().toLowerCase().replace(/[^a-z]+/g, ' ')
  const terminal = TERMINAL_STATUS_WORDS.some((word) => status.split(/\s+/).includes(word) || status.includes(word))
  return !terminal && !String(order.id || '').startsWith('manual-serial-') && !String(order.salesOrderNumber || '').startsWith('SERIAL-')
}
