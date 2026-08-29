import type { Order } from '@/types/domain'
import { getSyncedOrder, isOperationalZohoOrder } from './synced-orders'
import { githubReadJson, listWorkflows } from './workflow-store'
import { isLocallyTerminal } from './operational-orders'

type CompletedStore = { completed: Record<string, { completedAt: string; order: Order; machineIds?: string[] }> }
const COMPLETED_PATH = 'data/packaging-completed-store.json'

export async function getMediaOrder(orderId: string) {
  const id = String(orderId || '')
  if (!id) return null
  const synced = await getSyncedOrder(id)
  const { data } = await githubReadJson<CompletedStore>(COMPLETED_PATH, { completed: {} })
  const { data: shipmentStore } = await githubReadJson<{ shipments: Record<string, { shipmentType?: 'direct' | 'transporter'; shippedAt?: string; lrCopy?: { url?: string } | null }> }>('data/ready-to-ship-store.json', { shipments: {} })
  const completed = data.completed || {}
  const entry = completed[id] || Object.values(completed).find((item) => item.order?.salesOrderNumber === id || item.order?.zohoSalesOrderId === id)
  if (entry?.order) return isLocallyTerminal(shipmentStore.shipments[entry.order.id]) ? null : entry.order
  const workflows = await listWorkflows()
  const workflow = workflows[id] || Object.values(workflows).find((item) => item.salesOrderNumber === id || item.processedOrder?.zohoSalesOrderId === id)
  const order = workflow?.processedOrder
  if (order) return isLocallyTerminal(shipmentStore.shipments[order.id]) ? null : order
  return synced && isOperationalZohoOrder(synced) ? synced : null
}
