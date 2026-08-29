import { listOrdersModuleOrders, readSyncedOrdersStore } from './synced-orders'

export type WoodenPackingQueue = {
  lastSuccessAt?: string | null
  items: {
    id: string
    salesOrderId: string
    salesOrderNumber: string
    customerName: string
    itemName: string
    requiredQuantity: number
  }[]
}

export async function buildWoodenPackingQueue(): Promise<WoodenPackingQueue> {
  const store = await readSyncedOrdersStore()
  const orders = await listOrdersModuleOrders()
  const items: WoodenPackingQueue['items'] = []

  for (const order of orders) {
    for (const item of order.lineItems) {
      if (!item.woodenPackingRequired || item.quantity <= 0) continue
      items.push({
        id: `${order.id}-${item.id}`,
        salesOrderId: order.id,
        salesOrderNumber: order.salesOrderNumber,
        customerName: order.customerName,
        itemName: item.itemName,
        requiredQuantity: item.quantity,
      })
    }
  }

  return { lastSuccessAt: store.lastSuccessfulSyncAt, items }
}
