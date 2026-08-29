import type { Order } from '../types/domain.ts'
import type { OrderWorkflow } from './workflow-store.ts'

export type OperationalStage = 'open' | 'processed' | 'loading_video' | 'ready_to_ship' | 'builty_needed'
type Snapshot = { order?: Order }
type MediaRecord = { submittedAt?: string | null }
type Shipment = { shipmentType?: 'direct' | 'transporter'; shippedAt?: string; lrCopy?: { url?: string } | null }

export type OperationalProjectionInput = {
  syncedOrders: Order[]
  workflows?: Record<string, OrderWorkflow>
  completed?: Record<string, ({ completedAt?: string } & Snapshot)>
  packingRecords?: Record<string, MediaRecord>
  loadingRecords?: Record<string, MediaRecord>
  shipments?: Record<string, Shipment>
  tombstones?: Record<string, LifecycleTombstone>
}

export type LifecycleTombstone = {
  orderId: string
  salesOrderNumber: string
  reason: 'baseline_pre_cutover_zoho_closed_or_omitted'
  stageAtCutover: OperationalStage
  tombstonedAt: string
  cutoverVersion: string
  cutoverDate: string
}
export type LifecycleBaselineStore = { version: 1; cutoverVersion: string; cutoverDate: string; tombstones: Record<string, LifecycleTombstone> }
export const LIFECYCLE_BASELINE_PATH = 'data/operational-lifecycle-baseline.json'

export function isLocallyTerminal(shipment?: Shipment) {
  if (!shipment?.shippedAt) return false
  return shipment.shipmentType !== 'transporter' || Boolean(shipment.lrCopy?.url)
}

function activeZoho(order: Order) {
  const status = String(order.status || '').trim().toLowerCase()
  return !new Set(['closed', 'cancelled', 'canceled', 'void']).has(status) && !String(order.id || '').startsWith('manual-serial-')
}

/** The single lifecycle boundary used by downstream operational views.
 * Zoho governs orders only until a durable local process snapshot exists. */
export function projectOperationalOrders(input: OperationalProjectionInput) {
  const workflows = input.workflows || {}
  const completed = input.completed || {}
  const packing = input.packingRecords || {}
  const loading = input.loadingRecords || {}
  const shipments = input.shipments || {}
  const tombstones = input.tombstones || {}
  const syncedById = new Map(input.syncedOrders.map((order) => [order.id, order]))
  const ids = new Set([...syncedById.keys(), ...Object.keys(workflows), ...Object.keys(completed)])
  const byId: Record<string, { order: Order; stage: OperationalStage; showInDispatch: boolean; showInPackingVideo: boolean; showInLoadingVideo: boolean; showInReadyToShip: boolean }> = {}

  for (const id of ids) {
    // Baseline terminal decisions win; source workflow/media/history remain intact.
    if (tombstones[id]) continue
    const workflow = workflows[id]
    const durableOrder = workflow?.processedOrder || completed[id]?.order
    const synced = syncedById.get(id)
    const processed = Boolean(durableOrder && (workflow?.status === 'processed' || workflow?.processedAt || Object.values(workflow?.machines || {}).some((machine) => machine.processedAt) || completed[id]))
    if (!processed && (!synced || !activeZoho(synced))) continue
    const order = (durableOrder ? { ...synced, ...durableOrder } : synced) as Order
    if (!order || isLocallyTerminal(shipments[id])) continue
    const packagingCompleted = Boolean(completed[id])
    const packingSubmitted = Boolean(packing[id]?.submittedAt)
    const loadingSubmitted = Boolean(loading[id]?.submittedAt)
    const builtyNeeded = shipments[id]?.shipmentType === 'transporter' && Boolean(shipments[id]?.shippedAt) && !shipments[id]?.lrCopy?.url
    const stage: OperationalStage = builtyNeeded ? 'builty_needed' : loadingSubmitted || packingSubmitted ? 'ready_to_ship' : packagingCompleted ? 'loading_video' : processed ? 'processed' : 'open'
    byId[id] = {
      order, stage,
      showInDispatch: processed && !packagingCompleted,
      showInPackingVideo: processed && !packagingCompleted,
      showInLoadingVideo: packagingCompleted && !loadingSubmitted,
      showInReadyToShip: packagingCompleted && packingSubmitted,
    }
  }
  return { orders: Object.values(byId).map((entry) => entry.order), byId }
}

export async function loadOperationalProjection() {
  const [{ readSyncedOrdersStore }, { listWorkflows, githubReadJson }, { readMediaProofStore }, { readShipmentStore }] = await Promise.all([
    import('./synced-orders'), import('./workflow-store'), import('./media-proof'), import('./ready-to-ship'),
  ])
  const [synced, workflows, completedStore, packing, loading, shipmentStore, baselineStore] = await Promise.all([
    readSyncedOrdersStore(), listWorkflows(),
    githubReadJson<{ completed: Record<string, { completedAt?: string; order?: Order }> }>('data/packaging-completed-store.json', { completed: {} }),
    readMediaProofStore('packing'), readMediaProofStore('loading'), readShipmentStore(),
    githubReadJson<LifecycleBaselineStore>(LIFECYCLE_BASELINE_PATH, { version: 1, cutoverVersion: '', cutoverDate: '', tombstones: {} }),
  ])
  return projectOperationalOrders({
    syncedOrders: synced.orderIds.map((id) => synced.orders[id]).filter(Boolean), workflows,
    completed: completedStore.data.completed, packingRecords: packing.records,
    loadingRecords: loading.records, shipments: shipmentStore.shipments, tombstones: baselineStore.data.tombstones,
  })
}
