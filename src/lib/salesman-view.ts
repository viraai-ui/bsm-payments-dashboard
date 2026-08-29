import { githubReadJson, listProcessedOrders, type MachineWorkflow } from './workflow-store'
import { readSyncedOrdersStore } from './synced-orders'
import { listReadyToShipItems } from './ready-to-ship'
import { isMachineLineItem } from './item-classification'
import type { MachineUnit, Order, OrderLineItem } from '@/types/domain'

type CompletedStore = { completed: Record<string, { completedAt: string; order: Order; machineIds?: string[] }> }
type PriorityStore = { priorities: Record<string, { priority: 'urgent' | 'regular'; sortOrder?: number; updatedAt: string }> }

const COMPLETED_PATH = 'data/packaging-completed-store.json'
const PRIORITY_PATH = 'data/dispatch-priority-store.json'

export type SalesmanDispatchOrder = {
  id: string
  salesOrderNumber: string
  customerName: string
  shippingAddress?: string
  salesperson?: string
  deliveryDate?: string
  priority: 'urgent' | 'regular'
  machineCount: number
  machineNames: string[]
  machineLabels: string[]
}

export type SalesmanShipmentOrder = {
  id: string
  salesOrderNumber: string
  customerName: string
  shippingAddress?: string
  machineCount: number
  packingVideoUploaded: boolean
  needsBuilty: boolean
  machineNames: string[]
  machineLabels: string[]
}

export async function getSalesmanViewData() {

  const [processed, synced, completedRead, priorityRead, readyItems] = await Promise.all([
    listProcessedOrders(),
    readSyncedOrdersStore(),
    githubReadJson<CompletedStore>(COMPLETED_PATH, { completed: {} }),
    githubReadJson<PriorityStore>(PRIORITY_PATH, { priorities: {} }),
    listReadyToShipItems(),
  ])
  const completed = completedRead.data.completed || {}
  const priorities = priorityRead.data.priorities || {}
  const dispatchOrders: SalesmanDispatchOrder[] = processed

    .filter((item) => Boolean(item.processedOrder))
    .map((item) => {
      const processedIds = new Set(Object.values(item.machines || {}).filter((machine) => machine.processedAt && !machine.dispatchedAt).map((machine) => machine.machineUnitId))
      const order = enrichDescriptions(item.processedOrder as Order, synced.orders[item.salesOrderId], item.machines || {})
      const priority = priorities[item.salesOrderId]?.priority || item.dispatchPriority || 'regular'
      const machines = order.machines.filter((machine) => processedIds.has(machine.id))
      return {
        id: order.id,
        salesOrderNumber: order.salesOrderNumber,
        customerName: order.customerName,
        shippingAddress: order.shippingAddress,
        salesperson: order.salesperson,
        deliveryDate: order.deliveryDate,
        priority,
        machineCount: machines.length || countDispatchLineItems(order),
        machineNames: compactMachineNames(machines, order.lineItems),
        machineLabels: compactMachineLabels(machines, order.lineItems),
      }
    })
    .filter((order) => !completed[order.id])
    .filter((order) => order.machineCount > 0)
    .sort((a, b) => priorityWeight(a.priority) - priorityWeight(b.priority) || (Date.parse(a.deliveryDate || '') || 0) - (Date.parse(b.deliveryDate || '') || 0))

  const shipmentOrders: SalesmanShipmentOrder[] = readyItems.map((item) => ({
    id: item.id,
    salesOrderNumber: item.salesOrderNumber,
    customerName: item.customerName,
    shippingAddress: item.shippingAddress,
    machineCount: item.machines.length,
    packingVideoUploaded: item.packingVideoUploaded,
    needsBuilty: item.shipment?.shipmentType === 'transporter' && !item.shipment.lrCopy?.url,
    machineNames: compactMachineNames(item.machines, []),
    machineLabels: compactMachineLabels(item.machines, []),
  }))

  const urgentOrders = dispatchOrders.filter((order) => order.priority === 'urgent')
  const regularOrders = dispatchOrders.filter((order) => order.priority !== 'urgent')
  const urgentMachineCount = sumMachines(urgentOrders)
  const regularMachineCount = sumMachines(regularOrders)
  const shipmentMachineCount = sumMachines(shipmentOrders)
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      dispatchOrders: dispatchOrders.length,
      dispatchMachines: urgentMachineCount + regularMachineCount,
      urgentOrders: urgentOrders.length,
      urgentMachines: urgentMachineCount,
      regularOrders: regularOrders.length,
      regularMachines: regularMachineCount,
      shipmentOrders: shipmentOrders.length,
      shipmentMachines: shipmentMachineCount,
      totalWorkloadMachines: urgentMachineCount + regularMachineCount + shipmentMachineCount,
    },
    urgentOrders,
    regularOrders,
    shipmentOrders,
  }
}

function priorityWeight(priority: 'urgent' | 'regular') { return priority === 'urgent' ? 0 : 1 }
function sumMachines(orders: { machineCount: number }[]) { return orders.reduce((sum, order) => sum + (order.machineCount || 0), 0) }
function compactMachineNames(machines: MachineUnit[], lineItems: OrderLineItem[]) {
  const names = machines.length ? machines.map((machine) => machine.itemName) : lineItems.filter((item) => item.dispatchCategory !== 'freight').map((item) => item.itemName)
  return [...new Set(names.filter(Boolean))].slice(0, 4)
}
function compactMachineLabels(machines: MachineUnit[], lineItems: OrderLineItem[]) {
  const counts = new Map<string, number>()
  if (machines.length) {
    for (const machine of machines) counts.set(machine.itemName, (counts.get(machine.itemName) || 0) + 1)
  } else {
    for (const item of lineItems.filter((entry) => entry.dispatchCategory !== 'freight')) counts.set(item.itemName, (counts.get(item.itemName) || 0) + (item.pendingQuantity || item.quantity || 0))
  }
  return [...counts.entries()].filter(([name, qty]) => Boolean(name) && qty > 0).slice(0, 4).map(([name, qty]) => `${name} × ${qty}`)
}
function countDispatchLineItems(order: Order) {
  return (order.lineItems || []).filter((item) => item.dispatchCategory !== 'freight' && !isMachineLineItem(item)).reduce((sum, item) => sum + (item.pendingQuantity || item.quantity || 0), 0)
}
function enrichDescriptions(order: Order, synced?: Order, workflowMachines: Record<string, MachineWorkflow> = {}): Order {
  if (!synced) return order
  const lineDescriptions = new Map((synced.lineItems || []).map((item) => [item.id, item.description || '']))
  const liveMachines = new Map((synced.machines || []).map((machine) => [machine.id, machine]))
  return {
    ...order,
    salesperson: order.salesperson || synced.salesperson || '—',
    lineItems: mergeLineItemDescriptions(order.lineItems || [], synced.lineItems || []),
    machines: (order.machines || []).map((machine) => {
      const live = liveMachines.get(machine.id)
      const saved = workflowMachines[machine.id]
      return { ...machine, itemDescription: machine.itemDescription || live?.itemDescription || lineDescriptions.get(machine.lineItemId) || '', dispatchNote: saved?.dispatchNote || machine.dispatchNote || '' }
    }),
  }
}
function mergeLineItemDescriptions(current: OrderLineItem[], synced: OrderLineItem[]) {
  const syncedById = new Map(synced.map((item) => [item.id, item]))
  return current.map((item) => ({ ...item, description: item.description || syncedById.get(item.id)?.description || '' }))
}
