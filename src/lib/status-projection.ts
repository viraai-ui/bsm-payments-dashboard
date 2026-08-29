import type { Order } from '@/types/domain'
import type { MediaProofRecord } from './media-proof'
import { readMediaProofStore } from './media-proof'
import { buildStageMap, type OrderStage } from './order-stage'
import { listWorkflows, type OrderWorkflow } from './workflow-store'

export type MediaStatus = 'Pending' | 'Submitted' | 'Closed'
export type StatusTone = 'red' | 'green' | 'amber' | 'blue' | 'gray' | 'purple'

export type OrderStatusProjection = {
  lifecycleStage: OrderStage
  lifecycleLabel: string
  lifecycleTone: StatusTone
  mediaStatus: MediaStatus
  mediaLabel: string
  mediaTone: StatusTone
}

export function lifecycleLabel(stage: OrderStage) {
  return ({ open: 'Open', processed: 'Processed', packed: 'Packed', packing_video: 'Packing Video', loading_video: 'Loading Video', closed: 'Closed' } as Record<OrderStage, string>)[stage]
}

export function lifecycleTone(stage: OrderStage): StatusTone {
  return ({ open: 'gray', processed: 'amber', packed: 'blue', packing_video: 'purple', loading_video: 'purple', closed: 'green' } as Record<OrderStage, StatusTone>)[stage]
}

export function mediaStatusForOrder(order: Order, record?: MediaProofRecord): MediaStatus {
  return record?.submittedAt ? 'Submitted' : 'Pending'
}

export function mediaTone(status: MediaStatus): StatusTone {
  return status === 'Submitted' || status === 'Closed' ? 'green' : 'amber'
}

export function projectOrderStatus(order: Order, lifecycleStage: OrderStage = 'open', mediaRecord?: MediaProofRecord): OrderStatusProjection {
  const mediaStatus = lifecycleStage === 'closed' ? 'Closed' : mediaStatusForOrder(order, mediaRecord)
  return {
    lifecycleStage,
    lifecycleLabel: lifecycleLabel(lifecycleStage),
    lifecycleTone: lifecycleTone(lifecycleStage),
    mediaStatus,
    mediaLabel: mediaStatus,
    mediaTone: mediaTone(mediaStatus),
  }
}

export async function buildOrderStatusMap(orders: Order[], workflows?: Record<string, OrderWorkflow>) {
  const workflowMap = workflows || await listWorkflows()
  const [stages, packing, loading] = await Promise.all([buildStageMap(workflowMap), readMediaProofStore('packing'), readMediaProofStore('loading')])
  const mediaRecords = { ...packing.records, ...loading.records }
  const statuses: Record<string, OrderStatusProjection> = {}
  const visibleIds = new Set(orders.map((order) => order.id))
  const visibleStages: Record<string, OrderStage> = {}
  const visibleMediaRecords: Record<string, MediaProofRecord> = {}
  const visiblePackingMediaRecords: Record<string, MediaProofRecord> = {}
  const visibleLoadingMediaRecords: Record<string, MediaProofRecord> = {}
  for (const order of orders) {
    visibleStages[order.id] = stages[order.id] || 'open'
    if (mediaRecords[order.id]) visibleMediaRecords[order.id] = mediaRecords[order.id]
    if (packing.records[order.id]) visiblePackingMediaRecords[order.id] = packing.records[order.id]
    if (loading.records[order.id]) visibleLoadingMediaRecords[order.id] = loading.records[order.id]
    statuses[order.id] = projectOrderStatus(order, visibleStages[order.id], mediaRecords[order.id])
  }
  for (const id of Object.keys(stages)) if (!visibleIds.has(id)) delete stages[id]
  return { statuses, stages: visibleStages, mediaRecords: visibleMediaRecords, packingMediaRecords: visiblePackingMediaRecords, loadingMediaRecords: visibleLoadingMediaRecords }
}
