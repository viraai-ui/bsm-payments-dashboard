import { neon } from '@neondatabase/serverless'
import type { MachineUnit, Order } from '@/types/domain'

let sqlClient: ReturnType<typeof neon> | null = null

function masterDatabaseUrl() {
  return process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || ''
}

function sql() {
  const url = masterDatabaseUrl()
  if (!url) return null
  if (!sqlClient) sqlClient = neon(url)
  return sqlClient
}

function dateOnly(value?: string) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

function warrantyEnd(value?: string) {
  const start = dateOnly(value)
  if (!start) return null
  const date = new Date(`${start}T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + 13)
  return date.toISOString().slice(0, 10)
}

export async function upsertGeneratedSerialsToMasterDatabase(order: Order, machines: MachineUnit[], date: string) {
  const db = sql()
  const result = { synced: 0, skipped: 0, configured: Boolean(db), errors: [] as string[] }
  if (!db) return result
  const seen = new Set<string>()
  const purchaseDate = dateOnly(date)
  const warranty = warrantyEnd(date)
  for (const machine of machines) {
    const serial = String(machine.serialNumber || '').trim()
    if (!serial || seen.has(serial)) { result.skipped += 1; continue }
    seen.add(serial)
    try {
      await db`
        insert into machines (serial_number, sales_order_number, zoho_sales_order_id, customer_name, shipping_address, model_no, make, date_of_purchase, warranty_start, warranty_end, source)
        values (${serial}, ${order.salesOrderNumber || `SERIAL-${serial}`}, ${order.zohoSalesOrderId || order.id || null}, ${order.customerName || machine.customerName || 'Customer'}, ${order.shippingAddress || ''}, ${machine.itemName || ''}, ${machine.vendor || ''}, ${purchaseDate}, ${purchaseDate}, ${warranty}, 'dashboard')
        on conflict (serial_number) do update set
          sales_order_number = coalesce(excluded.sales_order_number, machines.sales_order_number),
          zoho_sales_order_id = coalesce(excluded.zoho_sales_order_id, machines.zoho_sales_order_id),
          customer_name = excluded.customer_name,
          shipping_address = excluded.shipping_address,
          model_no = excluded.model_no,
          make = excluded.make,
          date_of_purchase = coalesce(excluded.date_of_purchase, machines.date_of_purchase),
          warranty_start = coalesce(excluded.warranty_start, machines.warranty_start),
          warranty_end = coalesce(excluded.warranty_end, machines.warranty_end),
          updated_at = now()
      `
      result.synced += 1
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : 'Master database serial write failed')
    }
  }
  return result
}
