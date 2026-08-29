import type { MachineUnit, Order } from '@/types/domain'
import { classifyDispatchItem, isMachineLineItem } from './item-classification'
import { fetchZohoConfirmedOrders } from './zoho'
import { deriveWorkflowStatus, githubReadJson, githubWriteJson, listWorkflows, type OrderWorkflow } from './workflow-store'

export type SyncedOrdersStore = {
  orders: Record<string, Order>
  orderIds: string[]
  lastSuccessfulSyncAt: string | null
  lastAttemptAt?: string | null
  lastError?: string | null
  syncing?: boolean
}

const SYNCED_ORDERS_PATH = 'data/synced-confirmed-orders-store.json'
let inMemorySync: Promise<SyncedOrdersStore> | null = null

const fallbackStore: SyncedOrdersStore = { orders: {}, orderIds: [], lastSuccessfulSyncAt: null }

export async function readSyncedOrdersStore() {
  const { data } = await githubReadJson<SyncedOrdersStore>(SYNCED_ORDERS_PATH, fallbackStore)
  const store = normalizeStore(data)
  if (store.orderIds.length) return store
  return readBundledSyncedOrdersStore()
}

async function readBundledSyncedOrdersStore() {
  if (typeof window !== 'undefined') return fallbackStore
  try {
    const fsModule = 'node:fs/promises'
    const pathModule = 'node:path'
    const { readFile } = await import(fsModule)
    const path = await import(pathModule)
    const local = await readFile(path.join(process.cwd(), SYNCED_ORDERS_PATH), 'utf8')
    return normalizeStore(JSON.parse(local || JSON.stringify(fallbackStore)) as SyncedOrdersStore)
  } catch {
    return fallbackStore
  }
}

export function isOperationalZohoOrder(order: Order | null | undefined) {
  if (!order) return false
  const closedStatuses = new Set(['closed', 'void', 'cancelled', 'canceled'])
  const status = String(order.status || '').toLowerCase()
  return !closedStatuses.has(status) && !String(order.id || '').startsWith('manual-serial-') && !String(order.salesOrderNumber || '').startsWith('SERIAL-')
}

export async function getOperationalOrderIds() {
  const store = await readSyncedOrdersStore()
  return new Set(store.orderIds.filter((id) => isOperationalZohoOrder(store.orders[id])))
}

function normalizeStore(store: SyncedOrdersStore): SyncedOrdersStore {
  const rawOrders = store.orders || {}
  const orders = Object.fromEntries(Object.entries(rawOrders).map(([id, order]) => [id, normalizeOrder(order)]))
  const orderIds = (store.orderIds?.length ? store.orderIds : Object.keys(orders)).filter((id) => Boolean(orders[id]))
  return { ...fallbackStore, ...store, orders, orderIds }
}

function normalizeOrder(order: Order): Order {
  const lineItems = (order.lineItems || []).map((item) => {
    const withCategory = { ...item, dispatchCategory: item.dispatchCategory || classifyDispatchItem(item) }
    return withCategory
  })
  const machineLineIds = new Set(lineItems.filter(isMachineLineItem).map((item) => item.id))
  return { ...order, lineItems, machines: (order.machines || []).filter((machine) => machineLineIds.has(machine.lineItemId)) }
}

export async function writeSyncedOrdersStore(store: SyncedOrdersStore, message = 'Update confirmed sales order sync store') {
  await githubWriteJson(SYNCED_ORDERS_PATH, normalizeStore(store), message)
}

export async function listOrdersModuleOrders() {
  const store = await readSyncedOrdersStore()
  const workflows = await listWorkflows()
  return store.orderIds
    .map((id) => store.orders[id] ? applyWorkflow(store.orders[id], workflows[id]) : null)
    .filter((order): order is Order => order !== null)
    .filter(isOperationalZohoOrder)
}

export async function listSyncedOrders() {
  const [store, workflows] = await Promise.all([readSyncedOrdersStore(), listWorkflows()])
  return listSyncedOrdersFromSnapshots(store, workflows)
}

export function listSyncedOrdersFromSnapshots(store: SyncedOrdersStore, workflows: Record<string, OrderWorkflow>) {
  const orders = store.orderIds.map((id) => store.orders[id] ? applyWorkflow(store.orders[id], workflows[id]) : null).filter(Boolean) as Order[]
  const seen = new Set(orders.map((order) => order.id))
  for (const workflow of Object.values(workflows)) {
    const workflowOrder = workflow.processedOrder || buildWorkflowOnlyOrder(workflow)
    if (!workflowOrder || seen.has(workflowOrder.id)) continue
    orders.push(applyWorkflow(workflowOrder, workflow))
    seen.add(workflowOrder.id)
  }
  return orders
}

export async function getSyncedOrder(id: string) {
  const [store, workflows] = await Promise.all([readSyncedOrdersStore(), listWorkflows()])
  const workflowMatch = Object.values(workflows).find((item) => {
    const workflowOrder = item.processedOrder || buildWorkflowOnlyOrder(item)
    return workflowOrder && (workflowOrder.id === id || workflowOrder.zohoSalesOrderId === id || workflowOrder.salesOrderNumber === id)
  })
  const order = store.orders[id] || Object.values(store.orders).find((item) => item.zohoSalesOrderId === id || item.salesOrderNumber === id) || workflowMatch?.processedOrder || (workflowMatch ? buildWorkflowOnlyOrder(workflowMatch) : null)
  return order ? applyWorkflow(order, workflows[order.id]) : null
}

export async function syncConfirmedOrders() {
  if (inMemorySync) return inMemorySync
  inMemorySync = performSync().finally(() => { inMemorySync = null })
  return inMemorySync
}

async function performSync() {
  const previous = await readSyncedOrdersStore()
  if (previous.syncing && previous.lastAttemptAt && Date.now() - new Date(previous.lastAttemptAt).getTime() < 10 * 60 * 1000) {
    throw new Error('A confirmed order sync is already running')
  }
  await writeSyncedOrdersStore({ ...previous, syncing: true, lastAttemptAt: new Date().toISOString(), lastError: null }, 'Start confirmed sales order sync')
  try {
    const fetched = await fetchZohoConfirmedOrders()
    if (!Array.isArray(fetched)) throw new Error('Invalid Zoho response')
    if (!fetched.length) throw new Error('Zoho sync returned zero confirmed sales orders; keeping last saved data')
    if (fetched.some((order) => !order.id || !order.zohoSalesOrderId)) throw new Error('Zoho sync returned invalid sales order IDs')
    const orders: Record<string, Order> = {}
    for (const order of fetched) orders[order.id] = order
    const orderIds = fetched.map((order) => order.id)
    if (new Set(orderIds).size !== orderIds.length) throw new Error('Zoho sync returned duplicate sales order IDs')
    const next: SyncedOrdersStore = { orders, orderIds, lastSuccessfulSyncAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString(), lastError: null, syncing: false }
    await writeSyncedOrdersStore(next, 'Complete confirmed sales order sync')
    return next
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Confirmed sales order sync failed'
    const safe = { ...previous, syncing: false, lastAttemptAt: new Date().toISOString(), lastError: message }
    await writeSyncedOrdersStore(safe, 'Confirmed sales order sync failed')
    throw new Error(message)
  }
}

function applyWorkflow(order: Order, workflow?: OrderWorkflow): Order {
  if (!workflow) return order
  const workflowLineItems = new Map((workflow.processedOrder?.lineItems || []).map((item) => [item.id, item]))
  const workflowMachines = new Map((workflow.processedOrder?.machines || []).map((machine) => [machine.id, machine]))
  const lineItems = order.lineItems.map((item) => ({
    ...item,
    woodenPackingRequired: workflowLineItems.get(item.id)?.woodenPackingRequired || item.woodenPackingRequired,
  }))
  const machines = order.machines.map((machine) => applyMachineWorkflow({
    ...machine,
    woodenPacking: workflowMachines.get(machine.id)?.woodenPacking || machine.woodenPacking,
  }, workflow))
  const status = deriveWorkflowStatus(workflow, machines.length)
  return {
    ...order,
    lineItems,
    machines,
    dashboardStatus: status === 'processed' ? 'Processed' : status === 'qr_generated' ? 'QR Generated' : status === 'partially_generated' ? 'QR Generated' : order.dashboardStatus,
  }
}

function applyMachineWorkflow(machine: MachineUnit, workflow: OrderWorkflow): MachineUnit {
  const saved = workflow.machines?.[machine.id]
  if (!saved) return machine
  return {
    ...machine,
    serialNumber: saved.serialNumber || machine.serialNumber,
    qrToken: saved.qrToken || machine.qrToken,
    status: workflow.status === 'processed' ? 'Processed' : saved.qrStatus === 'generated' ? 'QR Generated' : saved.qrStatus === 'not_required' ? 'QR Printed' : machine.status,
  }
}

function buildWorkflowOnlyOrder(workflow: OrderWorkflow): Order | null {
  const workflowMachines = Object.values(workflow.machines || {}).filter((machine) => machine.serialNumber)
  if (!workflowMachines.length || !workflow.salesOrderId || !workflow.salesOrderNumber) return null
  const lineItemIds = Array.from(new Set(workflowMachines.map((machine) => machine.lineItemId || machine.machineUnitId).filter(Boolean)))
  return {
    id: workflow.salesOrderId,
    zohoSalesOrderId: workflow.salesOrderId,
    salesOrderNumber: workflow.salesOrderNumber,
    status: 'open',
    customerName: 'Workflow record',
    shippingAddress: 'Recovered from workflow serial database',
    salesperson: '—',
    deliveryDate: workflow.processedAt || workflowMachines[0]?.qrGeneratedAt || '',
    dashboardStatus: workflow.status === 'processed' ? 'Processed' : 'QR Generated',
    reviewRequired: false,
    lineItems: lineItemIds.map((lineItemId) => ({ id: lineItemId, itemName: 'Machine unit', sku: '—', quantity: workflowMachines.filter((machine) => (machine.lineItemId || machine.machineUnitId) === lineItemId).length || 1, pendingQuantity: 0, woodenPackingRequired: false, dispatchCategory: 'machine' })),
    machines: workflowMachines.map((machine, index) => ({
      id: machine.machineUnitId,
      unitNumber: index + 1,
      serialNumber: machine.serialNumber || '',
      qrToken: machine.qrToken || machine.serialNumber || '',
      orderId: workflow.salesOrderId,
      lineItemId: machine.lineItemId || machine.machineUnitId,
      itemName: 'Machine unit',
      sku: '—',
      customerName: 'Workflow record',
      salesOrderNumber: workflow.salesOrderNumber,
      deliveryDate: workflow.processedAt || machine.qrGeneratedAt || '',
      status: machine.dispatchedAt ? 'Dispatched' : machine.processedAt ? 'Processed' : machine.qrStatus === 'generated' ? 'QR Generated' : 'QR Printed',
      selectedForBatch: false,
      woodenPacking: 'Not Required',
      qrPasted: false,
      qcDone: false,
      mediaPhotos: 0,
      mediaVideos: 0,
      warrantyStart: machine.qrGeneratedAt?.slice(0, 10),
      dispatchNote: machine.dispatchNote,
    })),
  }
}
