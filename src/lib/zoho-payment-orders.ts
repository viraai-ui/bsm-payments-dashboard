export type ZohoPaymentOrder = {
  id: string
  salesOrderNumber: string
  customerName: string
  orderTotal: number
  orderDate: string
  rawStatus: string
  currency: string
}

type FetchLike = typeof fetch
const PAGE_SIZE = 200
const MAX_PAGES = 500
const TIMEOUT_MS = 12_000
let tokenCache: { value: string; expiresAt: number } | null = null
let tokenFlight: Promise<string> | null = null

function configured() {
  return Boolean(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET && process.env.ZOHO_REFRESH_TOKEN && process.env.ZOHO_ORGANIZATION_ID)
}

function domains() {
  const dc = process.env.ZOHO_DC || 'in'
  return {
    accounts: `https://accounts.zoho.${dc}`,
    api: process.env.ZOHO_API_DOMAIN || `https://www.zohoapis.${dc}`,
  }
}

async function fetchTimed(fetcher: FetchLike, input: string, init: RequestInit) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try { return await fetcher(input, { ...init, signal: controller.signal }) }
  finally { clearTimeout(timer) }
}

async function refreshToken(fetcher: FetchLike) {
  const body = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN!, client_id: process.env.ZOHO_CLIENT_ID!,
    client_secret: process.env.ZOHO_CLIENT_SECRET!, grant_type: 'refresh_token',
  })
  const response = await fetchTimed(fetcher, `${domains().accounts}/oauth/v2/token`, { method: 'POST', body, cache: 'no-store' })
  const data = await response.json() as { access_token?: string; expires_in?: number; error?: string }
  if (!response.ok || !data.access_token) throw new Error(data.error || 'Unable to refresh Zoho token')
  tokenCache = { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 }
  return data.access_token
}

async function accessToken(fetcher: FetchLike, force = false) {
  if (!configured()) throw new Error('Zoho credentials are not configured')
  if (!force && tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value
  if (!tokenFlight) tokenFlight = refreshToken(fetcher).finally(() => { tokenFlight = null })
  return tokenFlight
}

async function getPage(fetcher: FetchLike, page: number, token: string) {
  const query = new URLSearchParams({ organization_id: process.env.ZOHO_ORGANIZATION_ID!, per_page: String(PAGE_SIZE), page: String(page), sort_column: 'created_time', sort_order: 'D' })
  const url = `${domains().api}/inventory/v1/salesorders?${query}`
  let activeToken = token
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetchTimed(fetcher, url, { headers: { Authorization: `Zoho-oauthtoken ${activeToken}` }, cache: 'no-store' })
    const data = await response.json() as { code?: number; message?: string; salesorders?: unknown[]; page_context?: { has_more_page?: boolean; page?: number } }
    if (response.status === 401 && attempt === 0) { activeToken = await accessToken(fetcher, true); continue }
    if (response.ok && (!data.code || data.code === 0)) return data
    if (attempt < 2 && (response.status === 429 || response.status >= 500)) { await new Promise(resolve => setTimeout(resolve, 150 * 2 ** attempt)); continue }
    throw new Error(data.message || `Zoho sales-order request failed (${response.status})`)
  }
  throw new Error('Zoho sales-order request failed')
}

function statusOf(row: Record<string, unknown>) {
  const values = [row.status, row.current_sub_status, row.order_status, row.salesorder_status, row.shipment_status, row.invoiced_status]
    .map(value => String(value || '').trim()).filter(Boolean)
  const terminal = values.find(value => /(^|[ _-])(closed|void|cancelled|canceled|shipped|invoiced)($|[ _-])/i.test(value) && !/^not[ _-]/i.test(value))
  return terminal || values[0] || 'Status unknown'
}

function mapOrder(value: unknown): ZohoPaymentOrder | null {
  const row = (value || {}) as Record<string, unknown>
  const id = String(row.salesorder_id || '').trim(), salesOrderNumber = String(row.salesorder_number || row.reference_number || '').trim()
  if (!id || !salesOrderNumber) return null
  return {
    id, salesOrderNumber, customerName: String(row.customer_name || row.company_name || '').trim(),
    orderTotal: Number.isFinite(Number(row.total)) ? Number(row.total) : 0,
    orderDate: String(row.date || row.created_time || '').slice(0, 10), rawStatus: statusOf(row),
    currency: String(row.currency_code || row.currency_symbol || 'INR'),
  }
}

/** Read-only complete Zoho Inventory feed. No status filter and no write endpoint. */
export async function fetchAllZohoPaymentOrders(fetcher: FetchLike = fetch): Promise<ZohoPaymentOrder[]> {
  if (!configured()) throw new Error('Zoho credentials are not configured')
  let token = await accessToken(fetcher)
  const byId = new Map<string, ZohoPaymentOrder>()
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const data = await getPage(fetcher, page, token)
    const rows = data.salesorders || []
    if (!Array.isArray(rows)) throw new Error(`Invalid Zoho sales-order page ${page}`)
    for (const row of rows) { const mapped = mapOrder(row); if (mapped && !byId.has(mapped.id)) byId.set(mapped.id, mapped) }
    if (!data.page_context?.has_more_page || rows.length === 0) break
    if (data.page_context.page && Number(data.page_context.page) !== page) throw new Error(`Unexpected Zoho pagination response on page ${page}`)
    if (page === MAX_PAGES) throw new Error('Zoho pagination limit reached before completion')
    token = tokenCache?.value || token
  }
  return [...byId.values()].sort((a, b) => b.orderDate.localeCompare(a.orderDate) || b.salesOrderNumber.localeCompare(a.salesOrderNumber, undefined, { numeric: true }))
}

export function resetZohoPaymentOrdersForTests() { tokenCache = null; tokenFlight = null }
