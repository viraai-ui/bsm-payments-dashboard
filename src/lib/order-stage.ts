import type { Order } from '@/types/domain'
import { githubReadJson, githubWriteJson, type OrderWorkflow } from './workflow-store'
import { readMediaProofStore } from './media-proof'

export type OrderStage = 'open' | 'processed' | 'packed' | 'packing_video' | 'loading_video' | 'closed'
export type DispatchStore = { dispatched: Record<string, { dispatchedAt: string; order: Order }> }
export type CompletedStore = { completed: Record<string, { completedAt: string; order: Order; machineIds?: string[] }> }

const COMPLETED_PATH = 'data/packaging-completed-store.json'
const DISPATCH_PATH = 'data/dispatch-store.json'

export async function readCompletedStore() {
  const { data } = await githubReadJson<CompletedStore>(COMPLETED_PATH, { completed: {} })
  return { completed: data.completed || {} }
}

export async function readDispatchStore() {
  const { data } = await githubReadJson<DispatchStore>(DISPATCH_PATH, { dispatched: {} })
  return { dispatched: data.dispatched || {} }
}

export async function buildStageMap(workflows: Record<string, OrderWorkflow> = {}) {
  const completed = await readCompletedStore()
  const packing = await readMediaProofStore('packing')
  const loading = await readMediaProofStore('loading')
  const ids = new Set([...Object.keys(workflows), ...Object.keys(completed.completed), ...Object.keys(packing.records), ...Object.keys(loading.records)])
  const stages: Record<string, OrderStage> = {}
  for (const id of ids) {
    const workflow = workflows[id]
    if (loading.records[id]?.submittedAt) stages[id] = 'closed'
    else if (packing.records[id]?.submittedAt) stages[id] = 'loading_video'
    else if (completed.completed[id]) stages[id] = 'packing_video'
    else if (workflow?.status === 'processed' || Object.values(workflow?.machines || {}).some((machine) => machine.processedAt)) stages[id] = 'processed'
    else stages[id] = 'open'
  }
  return stages
}

export async function markDispatched(order: Order) {
  const store = await readDispatchStore()
  store.dispatched[order.id] = { dispatchedAt: new Date().toISOString(), order: { ...order, dashboardStatus: 'Dispatched' } }
  await githubWriteJson(DISPATCH_PATH, store, `Mark ${order.salesOrderNumber} dispatched`)
  return store.dispatched[order.id]
}
