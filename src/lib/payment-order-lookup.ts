export type PaymentOrderDisplayStatus = 'Open' | 'Closed' | 'Status unknown'
export type SearchablePaymentOrder = { id: string; salesOrderNumber: string; customerName: string; status: PaymentOrderDisplayStatus; rawStatus: string }

const TERMINAL = new Set(['closed', 'void', 'cancelled', 'canceled', 'shipped', 'invoiced'])
const KNOWN_OPEN = new Set(['open', 'draft', 'confirmed', 'partially shipped', 'partially invoiced', 'overdue', 'pending', 'approved', 'accepted', 'declined'])

export function paymentOrderStatus(rawStatus: unknown): PaymentOrderDisplayStatus {
  const normalized = String(rawStatus || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  if (!normalized) return 'Status unknown'
  const words = normalized.split(' ')
  // Zoho commonly returns negative invoice/shipment states such as
  // `not_invoiced`; those must not be mistaken for terminal orders.
  if (words.some((word, index) => TERMINAL.has(word) && words[index - 1] !== 'not')) return 'Closed'
  if (KNOWN_OPEN.has(normalized) || words.some((word) => KNOWN_OPEN.has(word))) return 'Open'
  return 'Status unknown'
}

export function normalizePaymentOrderSearch(value: unknown) {
  return String(value || '').toLocaleLowerCase().replace(/\s+/g, '')
}

export function filterPaymentOrderSuggestions<T extends SearchablePaymentOrder>(orders: T[], query: string, limit = 50) {
  const needle = normalizePaymentOrderSearch(query)
  return orders.filter((order) => !needle || normalizePaymentOrderSearch(`${order.salesOrderNumber}${order.customerName}`).includes(needle)).slice(0, needle ? limit : 10)
}
