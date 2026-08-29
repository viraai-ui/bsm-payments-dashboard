import type { Order } from '@/types/domain'
import { uploadBufferToGithubMedia } from './github-media'
import { githubReadJson, githubStoreConfigured, githubWriteJson, listProcessedOrders } from './workflow-store'
import { uploadBufferToWorkDrive, uploadVideoToWorkDrive } from './workdrive'
import { cleanupExpiredMediaProofStore, mediaExpiresAt } from './media-retention'
import { isMachineLineItem } from './item-classification'
import { buildR2Key, deleteR2Object, R2_VIDEO_MAX_BYTES, r2Configured, uploadBufferToR2, verifyR2Object } from './r2'
import { isLocallyTerminal } from './operational-orders'

export type MediaStage = 'packing' | 'loading'
export const LOADING_ORDER_UNIT_ID = 'loading-order'
const MAX_LOADING_VIDEOS = 5
export type MediaUpload = {
  id: string
  name: string
  type: string
  kind: 'photo' | 'video'
  url: string
  workdriveFileId?: string | null
  workdriveUrl?: string | null
  storageProvider?: 'r2' | 'workdrive' | 'github' | 'inline'
  r2Key?: string | null
  uploadedAt: string
  expiresAt?: string
}

export type MediaProofRecord = {
  orderId: string
  salesOrderNumber: string
  submittedAt?: string | null
  videoNotRequired?: boolean
  units: Record<string, { photos: MediaUpload[]; videos: MediaUpload[] }>
}

export type MediaProofStore = { records: Record<string, MediaProofRecord> }
const MEDIA_PATHS: Record<MediaStage, string> = {
  packing: 'data/media-proof-store.json',
  loading: 'data/loading-video-store.json',
}
const COMPLETED_PATH = 'data/packaging-completed-store.json'
type CompletedStore = { completed: Record<string, { completedAt: string; order: Order; machineIds?: string[] }> }
type ShipmentStore = { shipments: Record<string, { shipmentType?: 'direct' | 'transporter'; shippedAt?: string; lrCopy?: { url?: string } | null }> }


function mediaPath(stage: MediaStage = 'packing') { return MEDIA_PATHS[stage] }
function stageLabel(stage: MediaStage) { return stage === 'loading' ? 'loading video' : 'packing video' }

export async function readMediaProofStore(stage: MediaStage = 'packing') {
  const path = mediaPath(stage)
  const { data } = await githubReadJson<MediaProofStore>(path, { records: {} })
  return { records: data.records || {} }
}

export async function cleanupExpiredMediaProofs(stage: MediaStage = 'packing') {
  const path = mediaPath(stage)
  const { data } = await githubReadJson<MediaProofStore>(path, { records: {} })
  const cleaned = await cleanupExpiredMediaProofStore({ records: data.records || {} })
  if (cleaned.changed) await githubWriteJson(path, cleaned.store, `Cleanup expired ${stageLabel(stage)} files`)
  return cleaned.result
}

export async function listMediaProofOrders(stage: MediaStage = 'packing') {
  const { data: completedStore } = await githubReadJson<CompletedStore>(COMPLETED_PATH, { completed: {} })
  const { data: shipmentStore } = await githubReadJson<ShipmentStore>('data/ready-to-ship-store.json', { shipments: {} })
  const { data: baseline } = await githubReadJson<{ tombstones?: Record<string, unknown> }>('data/operational-lifecycle-baseline.json', {})
  const completed = completedStore.completed || {}
  const completedAtByOrderId = new Map(Object.entries(completed).map(([orderId, item]) => [orderId, Date.parse(item.completedAt || '') || 0]))
  const processedWorkflows = stage === 'packing' ? await listProcessedOrders() : []
  const packingStore = await readMediaProofStore('packing')
  const loadingStore = await readMediaProofStore('loading')
  const store = stage === 'loading' ? loadingStore : packingStore
  let packingChanged = false
  let loadingChanged = false

  const sourceOrders = (stage === 'packing' ? processedWorkflows.map((workflow) => workflow.processedOrder) : Object.values(completed).map((item) => item.order))
    .filter((order): order is Order => Boolean(order))
    .filter((order) => !baseline.tombstones?.[order.id])
    .filter((order) => !isLocallyTerminal(shipmentStore.shipments[order.id]))

  const sortTimeByOrderId = stage === 'packing'
    ? new Map(processedWorkflows.map((workflow) => [workflow.salesOrderId, Date.parse(workflow.processedAt || workflow.processedOrder?.deliveryDate || '') || 0]))
    : completedAtByOrderId

  for (const order of sourceOrders) {
    if (videoRequiredMachines(order).length === 0) {
      if (!packingStore.records[order.id]?.submittedAt) {
        packingStore.records[order.id] = { orderId: order.id, salesOrderNumber: order.salesOrderNumber, submittedAt: new Date().toISOString(), videoNotRequired: true, units: {} }
        packingChanged = true
      }
      if (!loadingStore.records[order.id]?.submittedAt) {
        loadingStore.records[order.id] = { orderId: order.id, salesOrderNumber: order.salesOrderNumber, submittedAt: new Date().toISOString(), videoNotRequired: true, units: {} }
        loadingChanged = true
      }
    }
  }
  // Local/read-only deployments still use bundled stores. Keep page reads usable
  // there; these opportunistic maintenance writes require a configured remote.
  if (packingChanged && githubStoreConfigured()) await githubWriteJson(mediaPath('packing'), packingStore, 'Auto-close packing video-not-required orders')
  if (loadingChanged && githubStoreConfigured()) await githubWriteJson(mediaPath('loading'), loadingStore, 'Auto-close loading video-not-required orders')

  const orders = sourceOrders
    .map((order) => ({ ...order, machines: videoRequiredMachines(order) }))
    .filter((order) => order.machines.length > 0)
    .filter((order) => stage === 'packing' ? !completed[order.id] : !store.records[order.id]?.submittedAt)
    .sort((a, b) => {
      if (stage === 'packing') {
        const aSubmitted = Boolean(store.records[a.id]?.submittedAt)
        const bSubmitted = Boolean(store.records[b.id]?.submittedAt)
        if (aSubmitted !== bSubmitted) return aSubmitted ? 1 : -1
      }
      return (sortTimeByOrderId.get(b.id) || 0) - (sortTimeByOrderId.get(a.id) || 0)
    })
  return { orders, records: store.records }
}

function videoRequiredMachines(order: Order) {
  const lineItemsById = new Map((order.lineItems || []).map((item) => [item.id, item]))
  return (order.machines || []).filter((machine) => {
    const lineItem = lineItemsById.get(machine.lineItemId)
    return Boolean(lineItem && isMachineLineItem(lineItem))
  })
}

export async function saveMediaUpload(order: Order, machineId: string, kind: 'photo' | 'video', upload: { name: string; type: string; dataUrl: string }, stage: MediaStage = 'packing') {
  const path = mediaPath(stage)
  const store = await readMediaProofStore(stage)
  const current = store.records[order.id] || { orderId: order.id, salesOrderNumber: order.salesOrderNumber, submittedAt: null, units: {} }
  const unit = current.units[machineId] || { photos: [], videos: [] }
  const machine = order.machines.find((item) => item.id === machineId)
  const extension = upload.name.includes('.') ? upload.name.split('.').pop() : mimeExtension(upload.type)
  const generatedName = `${safeName(order.salesOrderNumber)} - ${safeName(machine?.itemName || 'Machine')}${extension ? `.${extension}` : ''}`
  const workDrive = kind === 'video' ? await uploadVideoToWorkDrive(generatedName, upload.dataUrl, upload.type) : { fileId: null, url: null, storedInWorkDrive: false }
  const uploadedAt = new Date().toISOString()
  const file: MediaUpload = {
    id: `${machineId}-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: kind === 'video' ? generatedName : upload.name,
    type: upload.type,
    kind,
    url: workDrive.url || upload.dataUrl,
    workdriveFileId: workDrive.fileId,
    workdriveUrl: workDrive.url,
    storageProvider: workDrive.storedInWorkDrive ? 'workdrive' : 'inline',
    uploadedAt,
    expiresAt: mediaExpiresAt(uploadedAt),
  }
  const key = kind === 'photo' ? 'photos' : 'videos'
  current.units[machineId] = { ...unit, [key]: [...unit[key], file] }
  store.records[order.id] = current
  await githubWriteJson(path, store, `Save ${stageLabel(stage)} proof for ${order.salesOrderNumber}`)
  return current
}

export async function saveMediaUploadBuffer(order: Order, machineId: string, upload: { name: string; type: string; buffer: Buffer }, stage: MediaStage = 'packing') {
  const path = mediaPath(stage)
  const store = await readMediaProofStore(stage)
  const current = store.records[order.id] || { orderId: order.id, salesOrderNumber: order.salesOrderNumber, submittedAt: null, units: {} }
  const unit = current.units[machineId] || { photos: [], videos: [] }
  const machine = order.machines.find((item) => item.id === machineId)
  const extension = upload.name.includes('.') ? upload.name.split('.').pop() : mimeExtension(upload.type)
  const generatedName = `${safeName(order.salesOrderNumber)} - ${safeName(machine?.itemName || 'Machine')}${extension ? `.${extension}` : ''}`
  let storage: any
  try {
    if (r2Configured()) {
      const key = buildR2Key({ salesOrderNumber: order.salesOrderNumber, machineName: machine?.itemName || 'Machine', machineId, originalName: upload.name, mimeType: upload.type })
      const r2 = await uploadBufferToR2(key, upload.type, upload.buffer)
      storage = { storedInR2: true, key: r2.key, url: r2.publicUrl, expiresAt: r2.expiresAt }
    } else {
      storage = await uploadBufferToWorkDrive(generatedName, upload.buffer, upload.type)
    }
  } catch {
    try { storage = await uploadBufferToWorkDrive(generatedName, upload.buffer, upload.type) }
    catch { storage = await uploadBufferToGithubMedia(generatedName, upload.buffer, upload.type) }
  }
  if (!storage.url) storage = await uploadBufferToGithubMedia(generatedName, upload.buffer, upload.type)
  const uploadedAt = new Date().toISOString()
  const file: MediaUpload = {
    id: `${machineId}-video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: generatedName,
    type: upload.type,
    kind: 'video',
    url: storage.url || '',
    workdriveFileId: storage.storedInWorkDrive ? storage.fileId : null,
    workdriveUrl: storage.storedInWorkDrive ? storage.url : null,
    r2Key: storage.storedInR2 ? storage.key : null,
    storageProvider: storage.storedInR2 ? 'r2' : storage.storedInWorkDrive ? 'workdrive' : 'github',
    uploadedAt,
    expiresAt: storage.expiresAt || mediaExpiresAt(uploadedAt),
  }
  current.units[machineId] = { ...unit, videos: [...unit.videos, file] }
  store.records[order.id] = current
  await githubWriteJson(path, store, `Save ${stageLabel(stage)} proof for ${order.salesOrderNumber}`)
  return current
}

export async function registerWorkDriveVideo(order: Order, machineId: string, upload: { name: string; type: string; fileId: string | null; url: string | null }, stage: MediaStage = 'packing') {
  return registerStoredVideo(order, machineId, { ...upload, provider: 'workdrive' }, stage)
}

export async function registerR2Video(order: Order, machineId: string, upload: { name: string; type: string; key: string; url: string; expiresAt?: string | null }, stage: MediaStage = 'packing') {
  const expectedMachine = stage === 'loading' ? LOADING_ORDER_UNIT_ID : machineId
  const metadata = await verifyR2Object(upload.key, { prefixes: ['media-proof/'], expectedTypes: ['video/'], maxBytes: R2_VIDEO_MAX_BYTES, order: order.salesOrderNumber, machineId: expectedMachine, stage })
  return registerStoredVideo(order, machineId, { name: upload.name.slice(0, 180), type: metadata.contentType, fileId: null, url: `/api/r2/view?key=${encodeURIComponent(upload.key)}`, key: upload.key, expiresAt: null, provider: 'r2' }, stage)
}

export async function deleteMediaVideo(order: Order, machineId: string, videoId: string, stage: MediaStage = 'packing') {
  const path = mediaPath(stage)
  const store = await readMediaProofStore(stage)
  const record = store.records[order.id]
  if (!record) throw new Error(`No ${stageLabel(stage)} record found for this order`)
  const unit = record.units[machineId]
  if (!unit) throw new Error('Video not found')
  const deleting = (unit.videos || []).find((video) => video.id === videoId)
  if (deleting?.r2Key) await deleteR2Object(deleting.r2Key)
  const nextVideos = (unit.videos || []).filter((video) => video.id !== videoId)
  if (nextVideos.length === (unit.videos || []).length) throw new Error('Video not found')
  record.units[machineId] = { ...unit, videos: nextVideos }
  if (!record.units[machineId].photos.length && !record.units[machineId].videos.length) delete record.units[machineId]
  record.submittedAt = null
  record.videoNotRequired = false
  store.records[order.id] = record
  await githubWriteJson(path, store, `Delete ${stageLabel(stage)} video for ${order.salesOrderNumber}`)
  return record
}

async function registerStoredVideo(order: Order, machineId: string, upload: { name: string; type: string; fileId: string | null; url: string | null; key?: string | null; expiresAt?: string | null; provider: 'r2' | 'workdrive' }, stage: MediaStage) {
  const path = mediaPath(stage)
  const store = await readMediaProofStore(stage)
  const current = store.records[order.id] || { orderId: order.id, salesOrderNumber: order.salesOrderNumber, submittedAt: null, units: {} }
  const unit = current.units[machineId] || { photos: [], videos: [] }
  if (stage === 'loading' && machineId === LOADING_ORDER_UNIT_ID && unit.videos.length >= MAX_LOADING_VIDEOS) throw new Error(`Loading Video allows up to ${MAX_LOADING_VIDEOS} videos`)
  const uploadedAt = new Date().toISOString()
  const file: MediaUpload = {
    id: `${machineId}-video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: upload.name,
    type: upload.type,
    kind: 'video',
    url: upload.url || '',
    workdriveFileId: upload.provider === 'workdrive' ? upload.fileId : null,
    workdriveUrl: upload.provider === 'workdrive' ? upload.url : null,
    r2Key: upload.provider === 'r2' ? upload.key || null : null,
    storageProvider: upload.provider,
    uploadedAt,
    expiresAt: upload.expiresAt || mediaExpiresAt(uploadedAt),
  }
  current.units[machineId] = { ...unit, videos: [...unit.videos, file] }
  store.records[order.id] = current
  await githubWriteJson(path, store, `Save ${stageLabel(stage)} proof for ${order.salesOrderNumber}`)
  return current
}

export function mediaVideoFileName(order: Order, machineId: string, originalName: string, mimeType: string) {
  const machine = order.machines.find((item) => item.id === machineId)
  const extension = originalName.includes('.') ? originalName.split('.').pop() : mimeExtension(mimeType)
  return `${safeName(order.salesOrderNumber)} - ${safeName(machine?.itemName || 'Machine')}${extension ? `.${extension}` : ''}`
}

export async function submitMediaProof(order: Order, stage: MediaStage = 'packing') {
  const path = mediaPath(stage)
  const store = await readMediaProofStore(stage)
  const record = store.records[order.id]
  if (!record) throw new Error(`No ${stageLabel(stage)} proof found for this order`)
  if (!record.videoNotRequired) {
    if (stage === 'loading') {
      const count = record.units[LOADING_ORDER_UNIT_ID]?.videos?.length || 0
      if (count < 1) throw new Error('Upload at least 1 loading video before submitting')
      if (count > MAX_LOADING_VIDEOS) throw new Error(`Loading Video allows up to ${MAX_LOADING_VIDEOS} videos`)
    } else {
      const uploadedCount = videoRequiredMachines(order).reduce((sum, machine) => sum + (record.units[machine.id]?.videos?.length || 0), 0)
      if (uploadedCount < 1) throw new Error('Upload at least 1 packing video before submitting')
    }
  }
  record.submittedAt = new Date().toISOString()
  store.records[order.id] = record
  await githubWriteJson(path, store, `Submit ${stageLabel(stage)} proof for ${record.salesOrderNumber}`)
  return record
}

export async function proceedWithoutVideo(order: Order, stage: MediaStage = 'packing') {
  const path = mediaPath(stage)
  const store = await readMediaProofStore(stage)
  const current = store.records[order.id] || { orderId: order.id, salesOrderNumber: order.salesOrderNumber, submittedAt: null, units: {} }
  current.submittedAt = new Date().toISOString()
  current.videoNotRequired = true
  store.records[order.id] = current
  await githubWriteJson(path, store, `Proceed without ${stageLabel(stage)} for ${order.salesOrderNumber}`)
  return current
}

function safeName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim()
}

function mimeExtension(type: string) {
  if (type.includes('mp4')) return 'mp4'
  if (type.includes('quicktime')) return 'mov'
  if (type.includes('webm')) return 'webm'
  return ''
}
