export type PaymentOrderDisplayStatus = 'Open' | 'Closed' | 'Status unknown'
export type SearchablePaymentOrder = { id: string; salesOrderNumber: string; customerName: string; status: PaymentOrderDisplayStatus; rawStatus: string }

const TERMINAL = new Set(['closed', 'void', 'cancelled', 'canceled', 'shipped', 'invoiced'])
const KNOWN_OPEN = new Set(['open', 'draft', 'confirmed', 'partially shipped', 'partially invoiced', 'overdue', 'pending', 'approved', 'accepted', 'declined'])

export function paymentOrderStatus(rawStatus: unknown): PaymentOrderDisplayStatus {
  const normalized = String(rawStatus || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  if (!normalized) return 'Status unknown'
  if (KNOWN_OPEN.has(normalized)) return 'Open'
  const words = normalized.split(' ')
  // Zoho commonly returns negative invoice/shipment states such as
  // `not_invoiced`; those must not be mistaken for terminal orders.
  if (words.some((word, index) => TERMINAL.has(word) && words[index - 1] !== 'not')) return 'Closed'
  if (words.some((word) => KNOWN_OPEN.has(word))) return 'Open'
  return 'Status unknown'
}

export function normalizePaymentOrderSearch(value: unknown) {
  return String(value || '').toLocaleLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '')
}

export function paymentOrderNumberKey(value: unknown) {
  return normalizePaymentOrderSearch(value).replace(/^so/, '')
}

export function rankPaymentOrderSuggestions<T extends SearchablePaymentOrder>(orders: T[], query: string, limit = 50) {
  const needle = normalizePaymentOrderSearch(query), numberNeedle = paymentOrderNumberKey(query)
  const score = (order: T) => {
    const number = normalizePaymentOrderSearch(order.salesOrderNumber), numberKey = paymentOrderNumberKey(order.salesOrderNumber)
    const customer = normalizePaymentOrderSearch(order.customerName)
    if (needle && (number === needle || (numberNeedle && numberKey === numberNeedle))) return 0
    if (needle && (number.startsWith(needle) || (numberNeedle && numberKey.startsWith(numberNeedle)))) return 1
    if (needle && (number.includes(needle) || (numberNeedle && numberKey.includes(numberNeedle)))) return 2
    if (needle && customer.startsWith(needle)) return 3
    if (needle && customer.includes(needle)) return 4
    return needle ? 99 : 5
  }
  const unique = new Map<string, T>()
  for (const order of orders) if (order.id && !unique.has(order.id)) unique.set(order.id, order)
  return [...unique.values()].map((order, position) => ({ order, position, score: score(order) }))
    .filter(item => item.score < 99)
    .sort((a, b) => a.score - b.score || a.position - b.position || a.order.id.localeCompare(b.order.id))
    .slice(0, Math.max(0, limit)).map(item => item.order)
}

export function filterPaymentOrderSuggestions<T extends SearchablePaymentOrder>(orders: T[], query: string, limit = 50) {
  return rankPaymentOrderSuggestions(orders, query, query.trim() ? limit : Math.min(limit, 10))
}
