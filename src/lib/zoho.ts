import type { MachineUnit, Order, OrderLineItem } from '@/types/domain'
import { classifyDispatchItem, isMachineLineItem } from './item-classification'

const dc = process.env.ZOHO_DC || 'in'
const accountsDomain = `https://accounts.zoho.${dc}`
const apiDomain = process.env.ZOHO_API_DOMAIN || `https://www.zohoapis.${dc}`
let cachedAccessToken: { token: string; expiresAt: number } | null = null
let pendingAccessToken: Promise<string> | null = null
const itemDetailCache = new Map<string, { description: string; woodenPackingRequired: boolean }>()

function hasZohoConfig() {
  return Boolean(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET && process.env.ZOHO_REFRESH_TOKEN && process.env.ZOHO_ORGANIZATION_ID)
}

export async function getZohoAccessToken() {
  if (!hasZohoConfig()) throw new Error('Zoho credentials are not configured')
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) return cachedAccessToken.token
  if (pendingAccessToken) return pendingAccessToken
  pendingAccessToken = refreshAccessToken().finally(() => { pendingAccessToken = null })
  return pendingAccessToken
}

async function refreshAccessToken() {
  const body = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN!,
    client_id: process.env.ZOHO_CLIENT_ID!,
    client_secret: process.env.ZOHO_CLIENT_SECRET!,
    grant_type: 'refresh_token',
  })
  const response = await fetch(`${accountsDomain}/oauth/v2/token`, { method: 'POST', body, cache: 'no-store' })
  const data = await response.json()
  if (!response.ok || !data.access_token) throw new Error(data.error || 'Unable to refresh Zoho token')
  cachedAccessToken = { token: data.access_token as string, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 }
  return cachedAccessToken.token
}

async function zohoGet(path: string, token: string) {
  const separator = path.includes('?') ? '&' : '?'
  const url = `${apiDomain}${path}${separator}organization_id=${process.env.ZOHO_ORGANIZATION_ID}`
  const response = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` }, cache: 'no-store' })
  const data = await response.json()
  if (!response.ok || (data.code && data.code !== 0)) throw new Error(data.message || `Zoho request failed: ${path}`)
  return data
}

async function zohoGetWithRetry(path: string, token: string, retries = 3) {
  let lastError: unknown
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try { return await zohoGet(path, token) } catch (error) {
      lastError = error
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, attempt * 800))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Zoho request failed: ${path}`)
}

const closedStatuses = new Set(['closed', 'void', 'cancelled', 'canceled'])
function isOpenOrder(raw: any) {
  const status = String(raw.status || raw.current_sub_status || raw.order_status || raw.salesorder_status || '').toLowerCase()
  const shipment = String(raw.shipment_status || '').toLowerCase()
  const invoiced = String(raw.invoiced_status || '').toLowerCase()
  return !closedStatuses.has(status) && shipment !== 'shipped' && invoiced !== 'invoiced'
}

function readCustomField(source: any, names: string[]) {
  const fields = source?.custom_fields || source?.custom_field_hash || []
  if (Array.isArray(fields)) {
    const found = fields.find((f: any) => names.some((name) => String(f.label || f.api_name || f.placeholder || '').toLowerCase().includes(name)))
    return found?.value || found?.customfield_value
  }
  for (const key of Object.keys(fields || {})) {
    if (names.some((name) => key.toLowerCase().includes(name))) return fields[key]
  }
  return undefined
}

function cleanDescription(value: unknown) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function lineItemDescription(item: any) {
  return cleanDescription(
    item.description
    || item.item_description
    || item.sales_description
    || item.long_description
    || item.item_custom_fields?.description
    || readCustomField(item, ['description', 'specification', 'specifications'])
  )
}

function isWoodenPackingLineItem(item: any) {
  const itemWooden = readCustomField(item, ['wooden packing', 'wooden', 'packing'])
    || item.custom_field_hash?.cf_wooden_packing_unformatted
    || item.custom_field_hash?.cf_wooden_packing
    || item.cf_wooden_packing_unformatted
    || item.cf_wooden_packing
  const itemWoodenText = String(itemWooden || '').toLowerCase().trim()
  const itemWoodenQty = Number(String(itemWooden || '').replace(/[^0-9.]/g, ''))

  return itemWoodenText === 'yes'
    || itemWoodenText.includes('wooden packing')
    || itemWoodenQty > 0
}

function mapLineItems(order: any): OrderLineItem[] {
  return (order.line_items || []).map((item: any, index: number) => {
    const quantity = Number(item.quantity || 0)
    const shipped = Number(item.quantity_shipped || item.shipped_quantity || 0)
    const woodenRequired = isWoodenPackingLineItem(item)
    const lineItem = {
      id: String(item.line_item_id || item.item_id || `line-${index}`),
      itemName: String(item.name || item.item_name || 'Machine'),
      sku: String(item.sku || ''),
      description: lineItemDescription(item),
      quantity,
      pendingQuantity: Math.max(0, quantity - shipped),
      woodenPackingRequired: woodenRequired,
      dimensions: item.dimensions,
    }
    return { ...lineItem, dispatchCategory: classifyDispatchItem(lineItem) }
  })
}

function buildUnits(order: any, lineItems: OrderLineItem[]): MachineUnit[] {
  const units: MachineUnit[] = []
  for (const item of lineItems) {
    if (!isMachineLineItem(item)) continue
    for (let i = 1; i <= item.pendingQuantity; i += 1) {
      units.push({
        id: `${order.salesorder_id}-${item.id}-${i}`,
        unitNumber: units.length + 1,
        serialNumber: '',
        qrToken: '',
        orderId: String(order.salesorder_id),
        lineItemId: item.id,
        itemName: item.itemName,
        sku: item.sku,
        customerName: String(order.customer_name || ''),
        salesOrderNumber: String(order.salesorder_number || order.reference_number || ''),
        deliveryDate: String(order.shipment_date || order.delivery_date || order.date || ''),
        status: 'Not Generated',
        selectedForBatch: false,
        woodenPacking: item.woodenPackingRequired ? 'Pending' : 'Not Required',
        qrPasted: false,
        qcDone: false,
        mediaPhotos: 0,
        mediaVideos: 0,
        itemDescription: item.description,
      })
    }
  }
  return units
}

function formatZohoAddress(address: any) {
  if (!address) return undefined
  const parts = [
    address.address,
    address.street2,
    address.city,
    address.state,
    address.zip || address.zipcode || address.pin_code || address.postal_code,
    address.country,
  ].map((part) => String(part || '').trim()).filter(Boolean)
  return [...new Set(parts)].join(', ') || undefined
}

function orderShippingAddress(order: any) {
  return formatZohoAddress(order.shipping_address) || formatZohoAddress(order.billing_address)
}

function mapOrderSummary(order: any): Order {
  return {
    id: String(order.salesorder_id),
    zohoSalesOrderId: String(order.salesorder_id),
    salesOrderNumber: String(order.salesorder_number || order.reference_number || ''),
    status: String(order.shipment_status || '').toLowerCase() === 'partially_shipped' ? 'partially_shipped' : 'open',
    customerName: String(order.customer_name || ''),
    customerEmail: order.email,
    customerPhone: order.phone,
    shippingAddress: orderShippingAddress(order),
    salesperson: order.salesperson_name || order.salesperson || order.sales_person_name,
    deliveryDate: String(order.shipment_date || order.delivery_date || order.date || ''),
    dashboardStatus: 'Not Generated',
    reviewRequired: false,
    lineItems: [],
    machines: [],
  }
}

function mapPaymentOrderSummary(order: any): Order {
  const values = [order.status, order.current_sub_status, order.order_status, order.salesorder_status, order.shipment_status, order.invoiced_status]
    .map((value) => String(value || '').trim()).filter(Boolean)
  const rawStatus = values.find((value) => {
    const words = value.toLowerCase().replace(/[_-]+/g, ' ').split(/\s+/)
    return words.some((word, index) => ['closed', 'void', 'cancelled', 'canceled', 'shipped', 'invoiced'].includes(word) && words[index - 1] !== 'not')
  }) || values[0] || ''
  return { ...mapOrderSummary(order), status: rawStatus as Order['status'] }
}

function mapOrder(order: any): Order {
  const lineItems = mapLineItems(order)
  const machines = buildUnits(order, lineItems)
  return {
    id: String(order.salesorder_id),
    zohoSalesOrderId: String(order.salesorder_id),
    salesOrderNumber: String(order.salesorder_number || order.reference_number || ''),
    status: String(order.shipment_status || '').toLowerCase() === 'partially_shipped' ? 'partially_shipped' : 'open',
    customerName: String(order.customer_name || ''),
    customerEmail: order.email,
    customerPhone: order.phone,
    shippingAddress: orderShippingAddress(order),
    salesperson: order.salesperson_name || order.salesperson || order.sales_person_name,
    deliveryDate: String(order.shipment_date || order.delivery_date || order.date || ''),
    dashboardStatus: machines.length ? 'Not Generated' : 'Review Required',
    reviewRequired: false,
    lineItems,
    machines,
  }
}

export async function fetchZohoOpenOrders(maxPages = 1): Promise<Order[]> {
  if (!hasZohoConfig()) throw new Error('Zoho credentials are not configured')
  const token = await getZohoAccessToken()
  const allOrders: any[] = []
  for (let page = 1; page <= maxPages; page += 1) {
    const list = await zohoGet(`/inventory/v1/salesorders?per_page=200&page=${page}`, token)
    allOrders.push(...(list.salesorders || []))
    const pageContext = list.page_context || {}
    if (!pageContext.has_more_page) break
  }
  const summaries = allOrders.filter(isOpenOrder)
  return summaries.map(mapOrderSummary)
}

/** Complete, read-only feed for payment suggestions; it never persists orders. */
export async function fetchZohoPaymentOpenOrders(): Promise<Order[]> {
  if (!hasZohoConfig()) throw new Error('Zoho credentials are not configured')
  const token = await getZohoAccessToken()
  const summaries: any[] = []
  for (let page = 1; page <= 500; page += 1) {
    const list = await zohoGetWithRetry(`/inventory/v1/salesorders?per_page=200&page=${page}&sort_column=created_time&sort_order=D`, token)
    const rows = list.salesorders || []
    if (!Array.isArray(rows)) throw new Error(`Invalid Zoho sales order page ${page}`)
    summaries.push(...rows)
    if (!list.page_context?.has_more_page || rows.length === 0) break
    if (page === 500) throw new Error('Zoho pagination limit reached before completion')
  }
  const seen = new Set<string>()
  return summaries.map(mapPaymentOrderSummary).filter((order) => {
    if (!order.id || seen.has(order.id)) return false
    seen.add(order.id)
    return true
  })
}

export async function fetchZohoConfirmedOrders(): Promise<Order[]> {
  if (!hasZohoConfig()) throw new Error('Zoho credentials are not configured')
  const token = await getZohoAccessToken()
  const summaries: any[] = []
  let pagesFetched = 0
  for (let page = 1; page <= 500; page += 1) {
    const list = await zohoGetWithRetry(`/inventory/v1/salesorders?filter_by=Status.Confirmed&per_page=200&page=${page}&sort_column=created_time&sort_order=D`, token)
    const rows = list.salesorders || []
    if (!Array.isArray(rows)) throw new Error(`Invalid Zoho sales order page ${page}`)
    summaries.push(...rows)
    pagesFetched = page
    const pageContext = list.page_context || {}
    if (Number(pageContext.page || page) !== page && pageContext.page) throw new Error(`Unexpected Zoho pagination response on page ${page}`)
    if (!pageContext.has_more_page || rows.length === 0) break
    if (page === 500) throw new Error('Zoho pagination limit reached before completion')
  }
  if (!pagesFetched) throw new Error('Zoho returned no pagination data')
  const seen = new Set<string>()
  const excludedStatuses = new Set(['draft', 'void', 'cancelled', 'canceled', 'closed'])
  const confirmed = summaries.filter((row) => {
    const id = String(row.salesorder_id || '')
    const status = String(row.status || row.current_sub_status || row.order_status || '').toLowerCase()
    if (!id || seen.has(id)) return false
    seen.add(id)
    return !excludedStatuses.has(status)
  })
  if (summaries.length > 0 && confirmed.length === 0) throw new Error('Zoho confirmed-order view returned no usable sales orders')
  return fetchZohoOrderDetailsInBatches(confirmed.map((summary) => String(summary.salesorder_id)), token)
}

async function fetchZohoOrderDetailsInBatches(ids: string[], token: string, batchSize = 8): Promise<Order[]> {
  const detailed: Order[] = []
  for (let index = 0; index < ids.length; index += batchSize) {
    const batch = ids.slice(index, index + batchSize)
    const orders = await Promise.all(batch.map((id) => fetchZohoOrderDetailWithToken(id, token)))
    detailed.push(...orders)
  }
  return detailed
}

async function enrichZohoLineItemDescriptions(order: any, token: string) {
  for (const item of order.line_items || []) {
    const itemId = String(item.item_id || '')
    if (!itemId) continue
    if (!itemDetailCache.has(itemId)) {
      try {
        const detail = await zohoGetWithRetry(`/inventory/v1/items/${itemId}`, token, 2)
        const zohoItem = detail.item || {}
        itemDetailCache.set(itemId, {
          description: cleanDescription(zohoItem.description || zohoItem.sales_description || zohoItem.purchase_description),
          woodenPackingRequired: isWoodenPackingLineItem(zohoItem),
        })
      } catch {
        itemDetailCache.set(itemId, { description: '', woodenPackingRequired: false })
      }
    }
    const detail = itemDetailCache.get(itemId)
    if (detail?.description && !lineItemDescription(item)) item.description = detail.description
    if (detail?.woodenPackingRequired) {
      item.custom_field_hash = { ...(item.custom_field_hash || {}), cf_wooden_packing_unformatted: 1 }
    }
  }
}

async function fetchZohoOrderDetailWithToken(id: string, token: string): Promise<Order> {
  const detail = await zohoGetWithRetry(`/inventory/v1/salesorders/${id}`, token)
  if (!detail.salesorder?.salesorder_id) throw new Error(`Invalid Zoho sales order detail for ${id}`)
  await enrichZohoLineItemDescriptions(detail.salesorder, token)
  return mapOrder(detail.salesorder)
}

export async function fetchZohoOrderDetail(id: string): Promise<Order> {
  if (!hasZohoConfig()) throw new Error('Zoho credentials are not configured')
  const token = await getZohoAccessToken()
  return fetchZohoOrderDetailWithToken(id, token)
}

export function zohoConfigured() { return hasZohoConfig() }
