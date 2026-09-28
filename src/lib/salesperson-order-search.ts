import type { OverviewOrder } from './salesperson-overview'

const statusTerms: Record<OverviewOrder['status'], string> = {
  NO_PAYMENT: 'payment not added no payment unpaid',
  PENDING: 'pending partial pending partial payment',
  RECEIVED: 'received paid payment received',
}

export const normalizeSalesOrderSearch = (value: unknown) =>
  String(value ?? '').toLocaleLowerCase('en-IN').replace(/[^a-z0-9]+/g, '')

const moneySearchValues = (value: number, currency: string) => {
  const formatted = new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: currency || 'INR', maximumFractionDigits: 0,
  }).format(value)
  return `${value} ${formatted}`
}

const dateSearchValues = (value: string) => {
  const parsed = Date.parse(value)
  if (!value || !Number.isFinite(parsed)) return value
  const date = new Date(parsed)
  return `${value} ${date.toLocaleDateString('en-IN')} ${date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
}

export function orderMatchesSalesSearch(order: OverviewOrder, query: string) {
  const needle = normalizeSalesOrderSearch(query)
  if (!needle) return true
  const searchable = [
    order.salesOrderNumber,
    order.customerName,
    dateSearchValues(order.orderDate),
    moneySearchValues(order.orderTotal, order.currency),
    moneySearchValues(order.received, order.currency),
    moneySearchValues(order.outstanding, order.currency),
    statusTerms[order.status],
  ].map(normalizeSalesOrderSearch).join(' ')
  return searchable.includes(needle)
}

/** Filters the already role-scoped canonical rows without reordering them. */
export function filterSalespersonOrders(orders: OverviewOrder[], query: string) {
  return query.trim() ? orders.filter(order => orderMatchesSalesSearch(order, query)) : orders
}
