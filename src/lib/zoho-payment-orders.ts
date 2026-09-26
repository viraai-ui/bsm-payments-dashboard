import { assertZohoEligible, recordZohoFailure, recordZohoSuccess } from './zoho-circuit'

export type ZohoPaymentOrder = {
  id: string
  salesOrderNumber: string
  customerName: string
  /** Authoritative Zoho sales-order total (tax/adjustments included). */
  total: number
  orderTotal: number
  orderDate: string
  rawStatus: string
  currency: string
  /** Zoho's ordering token. Reconciliation rejects responses older than this value. */
  modifiedTime: string
}

type FetchLike = typeof fetch
const PAGE_SIZE = 200
const TIMEOUT_MS = 20_000
const RETRIES = 5
const detailCache = new Map<string, { expiresAt: number; order: ZohoPaymentOrder }>()
let tokenCache: { value: string; expiresAt: number } | null = null
let tokenFlight: Promise<string> | null = null

function configured() {
  return Boolean(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET && process.env.ZOHO_REFRESH_TOKEN && process.env.ZOHO_ORGANIZATION_ID)
}
function domains() {
  const dc = process.env.ZOHO_DC || 'in'
  return { accounts: `https://accounts.zoho.${dc}`, api: process.env.ZOHO_API_DOMAIN || `https://www.zohoapis.${dc}` }
}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function fetchTimed(fetcher: FetchLike, input: string, init: RequestInit) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try { return await fetcher(input, { ...init, signal: controller.signal }) } finally { clearTimeout(timer) }
}
async function refreshToken(fetcher: FetchLike) {
  const body = new URLSearchParams({ refresh_token: process.env.ZOHO_REFRESH_TOKEN!, client_id: process.env.ZOHO_CLIENT_ID!, client_secret: process.env.ZOHO_CLIENT_SECRET!, grant_type: 'refresh_token' })
  const response = await fetchTimed(fetcher, `${domains().accounts}/oauth/v2/token`, { method: 'POST', body, cache: 'no-store' })
  const data = await response.json() as { access_token?: string; expires_in?: number; api_domain?: string; error?: string }
  if (!response.ok || !data.access_token) { const message=data.error||'Unable to refresh Zoho token';await recordZohoFailure(response.status,message);throw new Error(message) }
  tokenCache = { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 }
  return data.access_token
}
async function accessToken(fetcher: FetchLike, force = false) {
  if (!configured()) throw new Error('Zoho credentials are not configured')
  if (!force && tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value
  if (!tokenFlight) tokenFlight = refreshToken(fetcher).finally(() => { tokenFlight = null })
  return tokenFlight
}

export type ZohoResponse = { code?: number; message?: string; salesorders?: unknown[]; salesorder?: unknown; page_context?: { has_more_page?: boolean; page?: number } }
class ZohoQuotaError extends Error {}
async function zohoGet(fetcher: FetchLike, path: string, maxAttempts=RETRIES): Promise<ZohoResponse> {
  await assertZohoEligible()
  let token = await accessToken(fetcher)
  const separator = path.includes('?') ? '&' : '?'
  const url = `${domains().api}${path}${separator}organization_id=${encodeURIComponent(process.env.ZOHO_ORGANIZATION_ID!)}`
  let last: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetchTimed(fetcher, url, { headers: { Authorization: `Zoho-oauthtoken ${token}`, 'X-com-zoho-inventory-organizationid': process.env.ZOHO_ORGANIZATION_ID! }, cache: 'no-store' })
      const data = await response.json() as ZohoResponse
      if (response.status === 401 && attempt === 0) { token = await accessToken(fetcher, true); continue }
      if (response.ok && (!data.code || data.code === 0)) { await recordZohoSuccess(); return data }
      const retryable = response.status === 429 || response.status >= 500
      const message=data.message || `Zoho request failed (${response.status})`
      // Quota responses are hard stops. Never amplify a 429 with retries.
      if(response.status===429||/quota|rate.?limit|too many request|api usage/i.test(message)){await recordZohoFailure(response.status,message,Number(response.headers.get('retry-after'))||undefined);throw new ZohoQuotaError(message)}
      if (!retryable) { await recordZohoFailure(response.status,message); throw new Error(message) }
      if(attempt===maxAttempts-1)await recordZohoFailure(response.status,message,Number(response.headers.get('retry-after'))||undefined)
      last = new Error(message)
      const retryAfter = Number(response.headers.get('retry-after'))
      await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt)
    } catch (error) {
      last = error
      if(error instanceof ZohoQuotaError)throw error
      if (error instanceof Error && /^Zoho request failed \(4\d\d\)/.test(error.message)) throw error
      if (attempt < maxAttempts - 1) await wait(250 * 2 ** attempt)
    }
  }
  throw last instanceof Error ? last : new Error('Zoho request failed')
}
function statusOf(row: Record<string, unknown>) {
  const values = [row.status, row.current_sub_status, row.order_status, row.salesorder_status, row.shipment_status, row.invoiced_status].map(v => String(v || '').trim()).filter(Boolean)
  const terminal = values.find(value => /(^|[ _-])(closed|void|cancelled|canceled|shipped|invoiced)($|[ _-])/i.test(value) && !/^not[ _-]/i.test(value) && !/^partially[ _-]/i.test(value))
  return terminal || values[0] || 'Status unknown'
}
function numericTotal(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || !value.trim()) return undefined
  const normalized = value.trim().replace(/,/g, '')
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return undefined
  const number = Number(normalized)
  return Number.isFinite(number) ? number : undefined
}
export function mapZohoPaymentOrder(value: unknown): ZohoPaymentOrder | null {
  const row = (value || {}) as Record<string, unknown>
  const id = String(row.salesorder_id || '').trim(), salesOrderNumber = String(row.salesorder_number || row.reference_number || '').trim()
  const total = numericTotal(row.total)
  if (!id || !salesOrderNumber || total === undefined) return null
  return { id, salesOrderNumber, customerName: String(row.customer_name || row.company_name || '').trim(), total, orderTotal: total, orderDate: String(row.date || row.created_time || '').slice(0, 10), rawStatus: statusOf(row), currency: String(row.currency_code || row.currency_symbol || 'INR'), modifiedTime: String(row.last_modified_time || row.modified_time || row.updated_time || row.created_time || '') }
}
function mapSummary(value: unknown): Omit<ZohoPaymentOrder, 'total'|'orderTotal'> & { total?: number; orderTotal?: number } | null {
  const row = (value || {}) as Record<string, unknown>, id = String(row.salesorder_id || '').trim(), salesOrderNumber = String(row.salesorder_number || row.reference_number || '').trim()
  if (!id || !salesOrderNumber) return null
  const total = numericTotal(row.total)
  return { id, salesOrderNumber, customerName: String(row.customer_name || row.company_name || '').trim(), ...(total === undefined ? {} : { total, orderTotal: total }), orderDate: String(row.date || row.created_time || '').slice(0, 10), rawStatus: statusOf(row), currency: String(row.currency_code || row.currency_symbol || 'INR'), modifiedTime: String(row.last_modified_time || row.modified_time || row.updated_time || row.created_time || '') }
}
export async function fetchZohoPaymentOrderPage(page:number,options:{modifiedSince?:string;fetcher?:FetchLike}={}){
  const params=new URLSearchParams({per_page:String(PAGE_SIZE),page:String(page),sort_column:options.modifiedSince?'last_modified_time':'created_time',sort_order:'A'})
  if(options.modifiedSince)params.set('last_modified_time',options.modifiedSince)
  const data=await zohoGet(options.fetcher||fetch,`/inventory/v1/salesorders?${params}`),rows=data.salesorders||[]
  if(!Array.isArray(rows))throw new Error(`Invalid Zoho sales-order page ${page}`)
  if(data.page_context?.page&&Number(data.page_context.page)!==page)throw new Error(`Unexpected Zoho pagination response on page ${page}`)
  return {orders:rows.map(mapSummary).filter((x):x is NonNullable<typeof x>=>Boolean(x)),hasMore:Boolean(data.page_context?.has_more_page)}
}
export async function fetchZohoPaymentOrderDetail(id: string, fetcher: FetchLike = fetch, force = false, oneAttempt = false): Promise<ZohoPaymentOrder> {
  const cached = detailCache.get(id)
  if (!force && cached && cached.expiresAt > Date.now()) return cached.order
  const data = await zohoGet(fetcher, `/inventory/v1/salesorders/${encodeURIComponent(id)}`,oneAttempt?1:RETRIES)
  const order = mapZohoPaymentOrder(data.salesorder)
  if (!order || order.id !== id) throw new Error(`Zoho sales order ${id} has no authoritative total`)
  detailCache.set(id, { order, expiresAt: Date.now() + 5 * 60_000 })
  return order
}
async function hydrateMissingTotals(rows: ReturnType<typeof mapSummary>[], fetcher: FetchLike) {
  const valid = rows.filter((row): row is NonNullable<typeof row> => Boolean(row))
  const output: ZohoPaymentOrder[] = []
  for (let offset = 0; offset < valid.length; offset += 6) {
    const batch = valid.slice(offset, offset + 6)
    const resolved = await Promise.all(batch.map(row => row.total === undefined ? fetchZohoPaymentOrderDetail(row.id, fetcher) : Promise.resolve(row as ZohoPaymentOrder)))
    output.push(...resolved)
  }
  return output
}
/** Complete read-only feed: no status filter and terminates only when Zoho says there is no next page. */
export async function fetchAllZohoPaymentOrders(fetcher: FetchLike = fetch): Promise<ZohoPaymentOrder[]> {
  const byId = new Map<string, ZohoPaymentOrder>()
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({ per_page: String(PAGE_SIZE), page: String(page), sort_column: 'created_time', sort_order: 'D' })
    const data = await zohoGet(fetcher, `/inventory/v1/salesorders?${query}`)
    const rows = data.salesorders || []
    if (!Array.isArray(rows)) throw new Error(`Invalid Zoho sales-order page ${page}`)
    for (const raw of rows) { const mapped = mapSummary(raw); if (mapped && !byId.has(mapped.id)) byId.set(mapped.id, mapped as ZohoPaymentOrder) }
    if (data.page_context?.page && Number(data.page_context.page) !== page) throw new Error(`Unexpected Zoho pagination response on page ${page}`)
    if (!data.page_context?.has_more_page) break
    if (!rows.length) throw new Error(`Zoho reported another page after empty page ${page}`)
  }
  // List rows normally contain total. Missing totals stay detectable and are hydrated only when returned/selected.
  return [...byId.values()].filter(order => order.total !== undefined)
}
/** Server-side Zoho search. Search text matches SO number, reference and customer; empty returns recent. */
export async function searchZohoPaymentOrders(query = '', limit = 25, fetcher: FetchLike = fetch): Promise<ZohoPaymentOrder[]> {
  const wanted = Math.max(1, Math.min(limit, 50))
  const byId = new Map<string, NonNullable<ReturnType<typeof mapSummary>>>()
  const trimmed=query.trim(), compact=trimmed.replace(/[\s-]+/g,''), digits=compact.replace(/^so/i,'')
  const variants=trimmed ? [...new Set([trimmed,compact,/^\d+$/.test(digits)?digits:'',/^\d+$/.test(digits)?`SO-${digits}`:''].filter(Boolean))] : ['']
  for (const variant of variants) {
    for (let page = 1; ; page++) {
      const params = new URLSearchParams({ per_page: String(PAGE_SIZE), page: String(page), sort_column: 'created_time', sort_order: 'D' })
      if (variant) params.set('search_text', variant)
      const data = await zohoGet(fetcher, `/inventory/v1/salesorders?${params}`), rows = data.salesorders || []
      if (!Array.isArray(rows)) throw new Error(`Invalid Zoho sales-order search page ${page}`)
      for (const raw of rows) { const mapped = mapSummary(raw); if (mapped && !byId.has(mapped.id)) byId.set(mapped.id, mapped) }
      if (!data.page_context?.has_more_page) break
      if (!rows.length) throw new Error(`Zoho reported another search page after empty page ${page}`)
    }
    if (!trimmed || byId.size >= wanted) break
  }
  return hydrateMissingTotals([...byId.values()].slice(0, Math.max(wanted,50)), fetcher)
}

export async function hydrateZohoPaymentOrders(orders: Array<ZohoPaymentOrder | ReturnType<typeof mapSummary>>, fetcher: FetchLike = fetch) {
  return hydrateMissingTotals(orders, fetcher)
}
export function resetZohoPaymentOrdersForTests() { tokenCache = null; tokenFlight = null; detailCache.clear() }
