export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'PACKAGING_TEAM' | 'DISPATCH_TEAM' | 'VIEWER'
export type OrderStatus = 'open' | 'partially_shipped'
export type MachineStatus = 'Not Generated' | 'QR Generated' | 'QR Printed' | 'Processed' | 'Packing Done' | 'Media Done' | 'Vehicle Booked' | 'Dispatched' | 'Review Required'

export type DispatchCategory = 'machine' | 'adhesive' | 'freight' | 'other'

export type OrderLineItem = {
  id: string
  itemName: string
  sku: string
  quantity: number
  pendingQuantity: number
  woodenPackingRequired: boolean
  dispatchCategory?: DispatchCategory
  description?: string
  dimensions?: string
}

export type MachineUnit = {
  id: string
  unitNumber: number
  serialNumber: string
  qrToken: string
  orderId: string
  lineItemId: string
  itemName: string
  sku: string
  customerName: string
  salesOrderNumber: string
  deliveryDate: string
  status: MachineStatus
  selectedForBatch: boolean
  woodenPacking: 'Required' | 'Not Required' | 'Completed' | 'Pending'
  qrPasted: boolean
  qcDone: boolean
  mediaPhotos: number
  mediaVideos: number
  itemDescription?: string
  vehicleNumber?: string
  warrantyStart?: string
  warrantyEnd?: string
  vendor?: string
  dispatchNote?: string
}

export type Order = {
  id: string
  zohoSalesOrderId: string
  salesOrderNumber: string
  status: OrderStatus
  customerName: string
  customerEmail?: string
  customerPhone?: string
  shippingAddress?: string
  salesperson?: string
  deliveryDate: string
  dashboardStatus: MachineStatus
  reviewRequired: boolean
  lineItems: OrderLineItem[]
  machines: MachineUnit[]
}

export const statusTabs: { label: string; status: MachineStatus }[] = [
  { label: 'Not Generated', status: 'Not Generated' },
  { label: 'QR Generated', status: 'QR Generated' },
  { label: 'QR Printed', status: 'QR Printed' },
  { label: 'Processed', status: 'Processed' },
  { label: 'Packing Done', status: 'Packing Done' },
  { label: 'Media Done', status: 'Media Done' },
  { label: 'Vehicle Booked', status: 'Vehicle Booked' },
  { label: 'Dispatched', status: 'Dispatched' },
  { label: 'Review Required', status: 'Review Required' },
]
