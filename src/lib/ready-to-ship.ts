import type { MachineUnit, Order } from '@/types/domain'
import { githubReadJson, githubWriteJson } from './workflow-store'
import { readMediaProofStore, type MediaUpload } from './media-proof'


const COMPLETED_PATH = 'data/packaging-completed-store.json'
const TRANSPORTERS_PATH = 'data/transporters-store.json'
const SHIPMENTS_PATH = 'data/ready-to-ship-store.json'

type CompletedStore = { completed: Record<string, { completedAt: string; order: Order; machineIds?: string[] }> }

export type ReadyToShipItem = {
  id: string
  orderId: string
  salesOrderNumber: string
  customerName: string
  customerPhone?: string
  shippingAddress?: string
  salesperson?: string
  deliveryDate?: string
  completedAt?: string
  readyAt?: string
  machine: MachineUnit
  machines: MachineUnit[]
  videos: MediaUpload[]
  machineVideos: Record<string, MediaUpload[]>
  packingVideoUploaded: boolean
  shipment?: ShipmentRecord
}

export type Transporter = {
  id: string
  name: string
  phone: string
  notes?: string
  createdAt: string
}

export type ShipmentMessageStatus = 'not_configured' | 'sent' | 'failed' | 'skipped'
export type ShipmentRecord = {
  id: string
  itemId: string
  orderId: string
  machineId: string
  salesOrderNumber: string
  customerName: string
  customerPhone?: string
  salespersonName?: string
  salespersonPhone?: string
  transporterName: string
  transporterPhone?: string
  shipmentType?: 'direct' | 'transporter'
  lrCopy?: { name: string; type: string; url: string; r2Key?: string; expiresAt?: string | null } | null
  vehicleNumber: string
  driverName: string
  driverPhone: string
  expectedDelivery?: string
  notes?: string
  shippedAt: string
  messages: {
    customer: { status: ShipmentMessageStatus; phone?: string; error?: string; responseId?: string }
    salesperson: { status: ShipmentMessageStatus; phone?: string; error?: string; responseId?: string }
  }
}

export type TransporterStore = { transporters: Transporter[] }
export type ShipmentStore = { shipments: Record<string, ShipmentRecord> }

export async function listReadyToShipItems() {
  const [{ data: completedStore }, packingStore, shipmentStore, { data: baseline }] = await Promise.all([
    githubReadJson<CompletedStore>(COMPLETED_PATH, { completed: {} }),
    readMediaProofStore('packing'),
    readShipmentStore(),
    githubReadJson<{ tombstones?: Record<string, unknown> }>('data/operational-lifecycle-baseline.json', {}),
  ])

  const items: ReadyToShipItem[] = []
  for (const [orderId, completed] of Object.entries(completedStore.completed || {})) {
    if (baseline.tombstones?.[orderId]) continue
    const order = completed.order
    if (!order) continue

    const allowedMachineIds = new Set(completed.machineIds?.length ? completed.machineIds : (order.machines || []).map((machine) => machine.id))
    const record = packingStore.records[orderId]
    const machines = (order.machines || []).filter((machine) => allowedMachineIds.has(machine.id))
    if (!machines.length) continue
    const machineVideos = Object.fromEntries(machines.map((machine) => [machine.id, record?.units?.[machine.id]?.videos || []])) as Record<string, MediaUpload[]>
    const videos = machines.flatMap((machine) => machineVideos[machine.id] || [])
    const id = orderId
    const shipment = shipmentStore.shipments[id]
    const needsBuilty = shipment?.shipmentType === 'transporter' && !shipment.lrCopy?.url
    if (shipment && !needsBuilty) continue
    const readyAt = videos.reduce((latest, video) => !latest || video.uploadedAt > latest ? video.uploadedAt : latest, completed.completedAt || '')
    items.push({
      id,
      orderId,
      salesOrderNumber: order.salesOrderNumber,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      shippingAddress: order.shippingAddress,
      salesperson: order.salesperson,
      deliveryDate: order.deliveryDate,
      completedAt: completed.completedAt,
      readyAt,
      machine: machines[0],
      machines,
      videos,
      machineVideos,
      packingVideoUploaded: videos.length > 0 || Boolean(record?.submittedAt),
      shipment,
    })
  }
  return items.sort((a, b) => {
    const aNeedsBuilty = a.shipment?.shipmentType === 'transporter' && !a.shipment.lrCopy?.url
    const bNeedsBuilty = b.shipment?.shipmentType === 'transporter' && !b.shipment.lrCopy?.url
    if (aNeedsBuilty !== bNeedsBuilty) return aNeedsBuilty ? 1 : -1
    return Date.parse(b.shipment?.shippedAt || b.readyAt || b.completedAt || '') - Date.parse(a.shipment?.shippedAt || a.readyAt || a.completedAt || '')
  })
}

export async function readTransportersStore() {
  const { data } = await githubReadJson<TransporterStore>(TRANSPORTERS_PATH, { transporters: [] })
  const transporters = Array.isArray(data.transporters) ? [...data.transporters] : []
  return { transporters: transporters.sort((a, b) => Date.parse(a.createdAt || '') - Date.parse(b.createdAt || '')) }
}

export async function readShipmentStore() {
  const { data } = await githubReadJson<ShipmentStore>(SHIPMENTS_PATH, { shipments: {} })
  return { shipments: data.shipments || {} }
}

export async function addTransporter(input: { name: string; phone: string; notes?: string }) {
  const name = input.name.trim()
  const phone = input.phone.trim()
  if (!name) throw new Error('Transporter name is required')
  if (!phone) throw new Error('Transporter phone is required')
  const store = await readTransportersStore()
  const transporter: Transporter = {
    id: `tr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    phone,
    notes: input.notes?.trim() || '',
    createdAt: new Date().toISOString(),
  }
  store.transporters = [...store.transporters, transporter]
  await githubWriteJson(TRANSPORTERS_PATH, store, `Add transporter ${name}`)
  return transporter
}

export async function deleteTransporter(id: string) {
  const store = await readTransportersStore()
  const before = store.transporters.length
  store.transporters = store.transporters.filter((item) => item.id !== id)
  if (store.transporters.length === before) throw new Error('Transporter not found')
  await githubWriteJson(TRANSPORTERS_PATH, store, 'Delete transporter')
  return store
}

export async function updateTransporter(input: { id: string; name: string; phone: string; notes?: string }) {
  const id = input.id.trim()
  const name = input.name.trim()
  const phone = input.phone.trim()
  if (!id) throw new Error('Transporter id is required')
  if (!name) throw new Error('Transporter name is required')
  if (!phone) throw new Error('Transporter phone is required')
  const store = await readTransportersStore()
  const index = store.transporters.findIndex((item) => item.id === id)
  if (index === -1) throw new Error('Transporter not found')
  const updated = { ...store.transporters[index], name, phone, notes: input.notes?.trim() || '' }
  store.transporters[index] = updated
  await githubWriteJson(TRANSPORTERS_PATH, store, `Update transporter ${name}`)
  return updated
}

export async function processShipment(input: {
  itemId: string
  vehicleNumber: string
  driverName: string
  driverPhone: string
  transporterName: string
  transporterPhone?: string
  expectedDelivery?: string
  notes?: string
  customerPhone?: string
  salespersonName?: string
  salespersonPhone?: string
  sendWhatsapp?: boolean
  shipmentType?: 'direct' | 'transporter'
  lrCopy?: { name: string; type: string; url: string; r2Key?: string; expiresAt?: string | null } | null
}) {
  const item = (await listReadyToShipItems()).find((entry) => entry.id === input.itemId)
  if (!item) throw new Error('Ready to Ship machine not found')
  const vehicleNumber = input.vehicleNumber.trim()
  const driverName = input.driverName.trim()
  const driverPhone = input.driverPhone.trim()
  const transporterName = input.transporterName.trim()
  const shipmentType = input.shipmentType || 'direct'
  if (!transporterName) throw new Error('Transporter name is required')

  const record: ShipmentRecord = {
    id: `ship-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    itemId: item.id,
    orderId: item.orderId,
    machineId: item.machine.id,
    salesOrderNumber: item.salesOrderNumber,
    customerName: item.customerName,
    customerPhone: input.customerPhone?.trim() || item.customerPhone || '',
    salespersonName: input.salespersonName?.trim() || item.salesperson || '',
    salespersonPhone: input.salespersonPhone?.trim() || '',
    transporterName,
    transporterPhone: input.transporterPhone?.trim() || '',
    shipmentType,
    lrCopy: input.lrCopy || null,
    vehicleNumber: vehicleNumber || '—',
    driverName: driverName || '—',
    driverPhone: driverPhone || '—',
    expectedDelivery: input.expectedDelivery?.trim() || '',
    notes: input.notes?.trim() || '',
    shippedAt: new Date().toISOString(),
    messages: {
      customer: { status: input.sendWhatsapp ? 'skipped' : 'skipped', phone: input.customerPhone?.trim() || item.customerPhone || '' },
      salesperson: { status: input.sendWhatsapp ? 'skipped' : 'skipped', phone: input.salespersonPhone?.trim() || '' },
    },
  }

  const store = await readShipmentStore()
  store.shipments[item.id] = record
  await githubWriteJson(SHIPMENTS_PATH, store, `Ship ${item.salesOrderNumber} ${item.machine.itemName}`)
  return record
}


