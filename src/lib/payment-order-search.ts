import { readLocalJson } from './local-store'
import { normalizePaymentOrderSearch, paymentOrderStatus } from './payment-order-lookup'
import { fetchAllZohoPaymentOrders, type ZohoPaymentOrder } from './zoho-payment-orders'

const FILE = 'payment-order-index.json'
const FRESH_MS = 5 * 60_000
export type PaymentOrderSuggestion = { id: string; salesOrderNumber: string; customerName: string; rawStatus: string; status: 'Open'|'Closed'|'Status unknown'; orderDate: string; orderTotal: number; currency: string }
type StoredOrder = { id: string; salesOrderNumber: string; customerName: string; status: string; orderDate: string; orderTotal: number; currency?: string }
type Snapshot = { version: 1; updatedAt: string; orders: StoredOrder[] }
type Cache = { loadedAt: number; updatedAt: string; source: 'zoho_live'|'local_fallback'; fallbackReason?: string; orders: PaymentOrderSuggestion[] }
let cache: Cache | null = null
let flight: Promise<Cache> | null = null

function safe(o: StoredOrder | ZohoPaymentOrder): PaymentOrderSuggestion {
  const rawStatus = 'rawStatus' in o ? o.rawStatus : o.status
  return { ...o, currency: o.currency || 'INR', rawStatus, status: paymentOrderStatus(rawStatus) }
}
async function fallback(reason?: string): Promise<Cache> {
  const snapshot = await readLocalJson<Snapshot>(FILE, { version: 1, updatedAt: '', orders: [] })
  if (!Array.isArray(snapshot.orders)) throw new Error('Local payment order index is malformed')
  return { loadedAt: Date.now(), updatedAt: snapshot.updatedAt, source: 'local_fallback', fallbackReason: reason, orders: snapshot.orders.map(safe) }
}
async function load(force = false) {
  if (!force && cache && Date.now() - cache.loadedAt < FRESH_MS) return cache
  if (flight) return flight
  flight = (async () => {
    if (process.env.APP_LOCAL_ONLY === 'true') return (cache = await fallback('APP_LOCAL_ONLY is enabled'))
    try {
      const orders = (await fetchAllZohoPaymentOrders()).map(safe)
      if (!orders.length) throw new Error('Zoho returned no sales orders')
      return (cache = { loadedAt: Date.now(), updatedAt: new Date().toISOString(), source: 'zoho_live', orders })
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Zoho is unavailable'
      const local = await fallback(reason)
      if (!local.orders.length) throw new Error(`${reason}; no local fallback is available`)
      return (cache = local)
    }
  })().finally(() => { flight = null })
  return flight
}
export async function refreshPaymentOrderIndex(_force = false) { return load(true) }
export async function searchPaymentOrders(query = '', limit = 10) {
  const started = performance.now(), current = await load(), needle = normalizePaymentOrderSearch(query)
  const orders = current.orders.filter(o => !needle || normalizePaymentOrderSearch(`${o.salesOrderNumber} ${o.customerName}`).includes(needle))
    .slice(0, Math.max(1, Math.min(limit, 50)))
  return { orders, total: current.orders.length, updatedAt: current.updatedAt, source: current.source, fallbackReason: current.fallbackReason, stale: current.source === 'local_fallback', searchMs: performance.now() - started }
}
export async function validatePaymentOrder(id: string, number: string, customer?: string) {
  const current = await load()
  return current.orders.find(o => o.id === id && o.salesOrderNumber === number && (!customer || o.customerName === customer)) || null
}
export function resetPaymentOrderSearchForTests() { cache = null; flight = null }
