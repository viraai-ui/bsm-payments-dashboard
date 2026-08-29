import type { Order } from '@/types/domain'
import { listSerialSheetDatabaseOrders } from './serial-sheet-backup'
import { listSyncedOrdersFromSnapshots, readSyncedOrdersStore } from './synced-orders'
import { readDispatchStore } from './order-stage'
import { listWorkflows, type OrderWorkflow } from './workflow-store'
import { readShipmentStore } from './ready-to-ship'

export async function loadDatabaseOrders() {
  const [syncedStore, workflows, dispatchStore, shipmentStore] = await Promise.all([readSyncedOrdersStore(), listWorkflows(), readDispatchStore(), readShipmentStore()])
  const orders = listSyncedOrdersFromSnapshots(syncedStore, workflows)
  const syncedById = new Map(orders.map((order) => [order.id, order]))
  const workflowOrders = Object.entries(workflows)
    .map(([orderId, workflow]) => {
      const sourceOrder = syncedById.get(orderId) || workflow.processedOrder
      return sourceOrder ? databaseOrderFromWorkflow(sourceOrder, workflow) : null
    })
    .filter((order): order is Order => Boolean(order))
    .sort((a, b) => databaseSortTime(workflows[b.id], b) - databaseSortTime(workflows[a.id], a))
  const existingSerials = new Set(workflowOrders.flatMap((order) => order.machines.map((machine) => machine.serialNumber).filter(Boolean)))
  const serialSheet = await listSerialSheetDatabaseOrders(existingSerials)
  // Both sources are independently sorted. Sort again after merging so new
  // workflow serials never appear behind older serial-sheet records.
  const databaseOrders = [...workflowOrders, ...serialSheet.orders].sort((a, b) => highestSerial(b) - highestSerial(a) || b.salesOrderNumber.localeCompare(a.salesOrderNumber, undefined, { numeric: true }))

  const warrantyDates = {
    ...Object.fromEntries(workflowOrders.map((order) => [order.id, dispatchStore.dispatched[order.id]?.dispatchedAt || order.deliveryDate || ''])),
    ...serialSheet.warrantyDates,
  }
  return { databaseOrders, workflows, warrantyDates, serialSheet, shipmentRecords: shipmentStore.shipments }
}

export function highestSerial(order: Order) {
  return (order.machines || []).reduce((highest, machine) => {
    const serial = Number(String(machine.serialNumber || '').trim())
    return Number.isSafeInteger(serial) ? Math.max(highest, serial) : highest
  }, 0)
}

function databaseOrderFromWorkflow(order: Order, workflow?: OrderWorkflow): Order {
  if (!workflow?.processedOrder) return order
  const processedMachineIds = new Set((workflow.processedOrder.machines || []).map((machine) => machine.id))
  const workflowHasSerials = (workflow.processedOrder.machines || []).some((machine) => machine.serialNumber)
  if (!processedMachineIds.size || !workflowHasSerials) return order
  const syncedMachineById = new Map((order.machines || []).map((machine) => [machine.id, machine]))
  const machines = workflow.processedOrder.machines.map((machine) => ({
    ...(syncedMachineById.get(machine.id) || {}),
    ...machine,
  }))
  const processedLineItemIds = new Set(machines.map((machine) => machine.lineItemId).filter(Boolean))
  return {
    ...order,
    ...workflow.processedOrder,
    machines,
    lineItems: (workflow.processedOrder.lineItems || order.lineItems || []).filter((item) => !processedLineItemIds.size || processedLineItemIds.has(item.id)),
    dashboardStatus: order.dashboardStatus,
  }
}

function databaseSortTime(workflow: OrderWorkflow | undefined, order: Order) {
  const values = [
    workflow?.processedAt,
    ...(Object.values(workflow?.machines || {}).flatMap((machine) => [machine.dispatchedAt, machine.processedAt, machine.qrGeneratedAt])),
    order.deliveryDate,
  ].filter(Boolean) as string[]
  return values.reduce((latest, value) => {
    const time = Date.parse(value)
    return Number.isFinite(time) && time > latest ? time : latest
  }, 0)
}
