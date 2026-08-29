import type { Order } from '@/types/domain'

export type MachineWorkflow = {
  machineUnitId: string
  lineItemId: string
  serialNumber?: string
  qrCode?: string
  qrToken?: string
  qrStatus: 'pending' | 'generated' | 'not_required'
  qrGeneratedAt?: string
  qrNotRequiredAt?: string
  processedAt?: string
  dispatchedAt?: string
  dispatchNote?: string
  vendor?: string
  zohoBackupStatus?: 'pending' | 'synced' | 'error'
  zohoBackupQueuedAt?: string
  zohoBackupSyncedAt?: string
  zohoBackupLastAttemptAt?: string
  zohoBackupError?: string
}

export type OrderWorkflow = {
  salesOrderId: string
  salesOrderNumber: string
  status: 'open' | 'partially_generated' | 'qr_generated' | 'qr_not_required' | 'processed'
  processedAt?: string
  dispatchPriority?: 'urgent' | 'regular'
  dispatchSortOrder?: number
  processedOrder?: Order
  machines: Record<string, MachineWorkflow>
}

export type Store = { orders: Record<string, OrderWorkflow>; serialCounter?: number }
const STORE_PATH = 'data/workflow-store.json'
const INITIAL_SERIAL_COUNTER = 26270758

export function highestSerialCounter(store: Store) {
  const persisted = Number(store.serialCounter || INITIAL_SERIAL_COUNTER)
  let highest = Number.isFinite(persisted) ? Math.max(persisted, INITIAL_SERIAL_COUNTER) : INITIAL_SERIAL_COUNTER
  for (const order of Object.values(store.orders || {})) {
    for (const machine of Object.values(order.machines || {})) {
      const serial = Number(String(machine.serialNumber || '').trim())
      if (Number.isFinite(serial) && serial > highest) highest = serial
    }
  }
  return highest
}

function ghConfig() {
  return {
    token: process.env.GITHUB_TOKEN || '',
    owner: process.env.GITHUB_OWNER || 'viraai-ui',
    repo: process.env.GITHUB_REPO || 'bsm-dispatch-dashboard',
  }
}

export function githubStoreConfigured() {
  return Boolean(ghConfig().token)
}

export async function githubRequest(path: string, init: RequestInit = {}) {
  const { token, owner, repo } = ghConfig()
  if (!token) throw new Error('Workflow database is not configured')
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers || {}) },
    cache: 'no-store',
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Workflow database request failed')
  return data
}

export async function githubReadJson<T>(path: string, fallback: T): Promise<{ data: T; sha?: string }> {
  try {
    const data = await githubRequest(`/contents/${path}`)
    let content = data.content || ''
    if (!content && data.git_url) {
      const blobResponse = await fetch(data.git_url, {
        headers: { Authorization: `Bearer ${ghConfig().token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        cache: 'no-store',
      })
      const blob = await blobResponse.json().catch(() => ({}))
      if (!blobResponse.ok) throw new Error(blob.message || 'Workflow database blob request failed')
      content = blob.content || ''
    }
    const json = Buffer.from(content, 'base64').toString('utf8')
    return { data: JSON.parse(json || JSON.stringify(fallback)), sha: data.sha }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('Not Found') || message.includes('not configured')) return { data: fallback }
    throw error
  }
}

export async function githubWriteJson<T>(path: string, data: T, message: string) {
  const current = await githubReadJson<T>(path, data)
  const body: Record<string, string> = { message, content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64') }
  if (current.sha) body.sha = current.sha
  await githubRequest(`/contents/${path}`, { method: 'PUT', body: JSON.stringify(body) })
}

async function readBundledWorkflowStore(): Promise<Store | null> {
  if (typeof window !== 'undefined') return null
  try {
    const fsModule = 'node:fs/promises'
    const pathModule = 'node:path'
    const { readFile } = await import(fsModule)
    const path = await import(pathModule)
    const local = await readFile(path.join(process.cwd(), STORE_PATH), 'utf8')
    const parsed = JSON.parse(local || '{}') as Store
    return { serialCounter: INITIAL_SERIAL_COUNTER, ...parsed, orders: parsed.orders || {} }
  } catch {
    return null
  }
}

async function readStoreWithSha(): Promise<{ store: Store; sha?: string }> {
  const result = await githubReadJson<Store>(STORE_PATH, { orders: {}, serialCounter: INITIAL_SERIAL_COUNTER })
  const remoteStore = { serialCounter: INITIAL_SERIAL_COUNTER, ...result.data, orders: result.data.orders || {} }
  if (Object.keys(remoteStore.orders || {}).length > 0) return { store: remoteStore, sha: result.sha }
  const bundled = await readBundledWorkflowStore()
  if (bundled && Object.keys(bundled.orders || {}).length > 0) return { store: bundled, sha: result.sha }
  return { store: remoteStore, sha: result.sha }
}

async function writeStore(store: Store, sha?: string) {
  const body: Record<string, string> = { message: 'Update dispatch workflow store', content: Buffer.from(JSON.stringify(store, null, 2)).toString('base64') }
  if (sha) body.sha = sha
  await githubRequest(`/contents/${STORE_PATH}`, { method: 'PUT', body: JSON.stringify(body) })
}

export async function getOrderWorkflow(orderId: string) {
  const { store } = await readStoreWithSha()
  return store.orders[orderId] || null
}

export async function listWorkflows() {
  const { store } = await readStoreWithSha()
  return store.orders || {}
}

export async function listProcessedOrders() {
  const [{ store }, baseline] = await Promise.all([readStoreWithSha(), githubReadJson<{ tombstones?: Record<string, unknown> }>('data/operational-lifecycle-baseline.json', {})])
  return Object.values(store.orders).filter((order) => {
    if (baseline.data.tombstones?.[order.salesOrderId]) return false
    const machines = Object.values(order.machines || {})
    return machines.some((machine) => machine.processedAt && !machine.dispatchedAt) || (order.status === 'processed' && order.processedOrder && machines.length === 0)
  })
}

export async function upsertOrderWorkflow(orderId: string, updater: (current: OrderWorkflow | null, store: Store) => OrderWorkflow) {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { store, sha } = await readStoreWithSha()
    const next = updater(store.orders[orderId] || null, store)
    store.orders[orderId] = next
    try {
      await writeStore(store, sha)
      return next
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : ''
      if (!message.includes('sha') && !message.includes('409') && !message.includes('does not match')) break
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Workflow update conflict')
}

/** Mirror an already-authoritative allocation into the workflow store. Client-safe:
 * this module deliberately has no dependency (including dynamic imports) on pg/ledger code. */
export async function mirrorAllocatedSerialNumbers(orderId: string, allocated: Record<string, string>, order?: Order) {
  const uniqueIds = Object.keys(allocated).filter(Boolean)
  if (!uniqueIds.length) return allocated
  await upsertOrderWorkflow(orderId, (current, store) => {
    const machines = { ...(current?.machines || {}) }
    const orderMachinesById = new Map((order?.machines || []).map((machine) => [machine.id, machine]))
    let counter = highestSerialCounter(store)
    for (const machineUnitId of uniqueIds) {
      const existing = machines[machineUnitId]
      const sourceMachine = orderMachinesById.get(machineUnitId)
      const serialNumber = allocated[machineUnitId]
      if (!serialNumber) throw new Error(`Serial allocation missing for ${machineUnitId}`)
      if (existing?.serialNumber && existing.serialNumber !== serialNumber) throw new Error(`Workflow serial conflict for ${machineUnitId}`)
      counter = Math.max(counter, Number(serialNumber))
      machines[machineUnitId] = { ...existing, machineUnitId, lineItemId: existing?.lineItemId || sourceMachine?.lineItemId || '', serialNumber, qrToken: existing?.qrToken || sourceMachine?.qrToken || serialNumber, qrStatus: existing?.qrStatus || 'pending' }
    }
    store.serialCounter = counter
    return current ? { ...current, salesOrderNumber: current.salesOrderNumber || order?.salesOrderNumber || '', processedOrder: current.processedOrder || order, machines } : { salesOrderId: orderId, salesOrderNumber: order?.salesOrderNumber || '', status: 'open', processedOrder: order, machines }
  })
  return allocated
}

/** Legacy GitHub allocator. Only the server allocation service may choose this path. */
export async function allocateSerialNumbersLegacy(orderId: string, machineIds: string[], order?: Order) {
  const uniqueIds = Array.from(new Set(machineIds.filter(Boolean)))
  if (!uniqueIds.length) return {} as Record<string, string>
  const allocated: Record<string, string> = {}
  await upsertOrderWorkflow(orderId, (current, store) => {
      // The updater may be rerun after an optimistic-write conflict.
      for (const machineUnitId of uniqueIds) delete allocated[machineUnitId]
      const machines = { ...(current?.machines || {}) }
      const orderMachinesById = new Map((order?.machines || []).map((machine) => [machine.id, machine]))
      let counter = highestSerialCounter(store)
      for (const machineUnitId of uniqueIds) {
        const existing = machines[machineUnitId]
        const sourceMachine = orderMachinesById.get(machineUnitId)
        const serialNumber = existing?.serialNumber || allocated[machineUnitId] || sourceMachine?.serialNumber || String(++counter)
        if (!serialNumber) throw new Error(`Serial allocation missing for ${machineUnitId}`)
        counter = Math.max(counter, Number(serialNumber))
        allocated[machineUnitId] = serialNumber
        machines[machineUnitId] = { ...existing, machineUnitId, lineItemId: existing?.lineItemId || sourceMachine?.lineItemId || '', serialNumber, qrToken: existing?.qrToken || sourceMachine?.qrToken || serialNumber, qrStatus: existing?.qrStatus || 'pending' }
      }
      store.serialCounter = counter
      return current ? { ...current, salesOrderNumber: current.salesOrderNumber || order?.salesOrderNumber || '', processedOrder: current.processedOrder || order, machines } : { salesOrderId: orderId, salesOrderNumber: order?.salesOrderNumber || '', status: 'open', processedOrder: order, machines }
  })
  return allocated
}

export function deriveWorkflowStatus(workflow: OrderWorkflow | null, totalMachines: number): OrderWorkflow['status'] {
  if (!workflow) return 'open'
  const machines = Object.values(workflow.machines || {})
  const dispatched = machines.filter((machine) => machine.dispatchedAt).length
  const processed = machines.filter((machine) => machine.processedAt).length
  if (totalMachines > 0 && dispatched >= totalMachines) return 'processed'
  if (processed > 0) return 'processed'
  const generated = machines.filter((machine) => machine.qrStatus === 'generated').length
  const notRequired = machines.filter((machine) => machine.qrStatus === 'not_required').length
  if (notRequired && generated === 0) return 'qr_not_required'
  if (totalMachines > 0 && generated >= totalMachines) return 'qr_generated'
  if (generated > 0) return 'partially_generated'
  return 'open'
}
