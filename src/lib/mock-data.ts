import { addMonths, format, subDays } from 'date-fns'
import type { MachineUnit, Order } from '@/types/domain'

const warrantyEnd = (date: string) => format(subDays(addMonths(new Date(date), 12), 1), 'dd/MM/yyyy')

function unit(input: Omit<MachineUnit, 'id' | 'qrToken'>): MachineUnit {
  const serialNumber = input.serialNumber
  return { ...input, id: `mu-${serialNumber}`, qrToken: serialNumber ? `qr-${serialNumber}` : '', serialNumber }
}

export const orders: Order[] = [
  {
    id: 'so-1001', zohoSalesOrderId: 'z-so-1001', salesOrderNumber: 'SO-1001', status: 'open', customerName: 'Arihant Foods Pvt Ltd', customerEmail: 'ops@arihantfoods.in', customerPhone: '+91 98100 10001', shippingAddress: 'Arihant Foods, Kundli Industrial Area, Haryana', salesperson: 'Rahul Mehta', deliveryDate: '22/07/2026', dashboardStatus: 'Processed', reviewRequired: false,
    lineItems: [{ id: 'li-1001-bc', itemName: 'Belt Conveyor', sku: 'BSM-BC-900', quantity: 10, pendingQuantity: 10, woodenPackingRequired: true, dimensions: '2400 × 900 × 1100 mm' }],
    machines: [1, 2, 3, 4, 6].map((n) => unit({ unitNumber: n === 6 ? 5 : n, serialNumber: `26270000${n}`, orderId: 'so-1001', lineItemId: 'li-1001-bc', itemName: 'Belt Conveyor', sku: 'BSM-BC-900', customerName: 'Arihant Foods Pvt Ltd', salesOrderNumber: 'SO-1001', deliveryDate: '22/07/2026', status: 'Processed', selectedForBatch: true, woodenPacking: n === 1 ? 'Completed' : 'Pending', qrPasted: n === 1, qcDone: n === 1, mediaPhotos: 0, mediaVideos: 0 })),
  },
  {
    id: 'so-1002', zohoSalesOrderId: 'z-so-1002', salesOrderNumber: 'SO-1002', status: 'partially_shipped', customerName: 'Delhi Packaging Co.', customerEmail: 'factory@delhipackaging.in', customerPhone: '+91 98100 10002', shippingAddress: 'Okhla Industrial Area, New Delhi', salesperson: 'Neha Sharma', deliveryDate: '25/07/2026', dashboardStatus: 'Media Done', reviewRequired: false,
    lineItems: [{ id: 'li-1002-be', itemName: 'Bucket Elevator', sku: 'BSM-BE-1200', quantity: 6, pendingQuantity: 3, woodenPackingRequired: false }],
    machines: [1, 2, 3].map((n) => unit({ unitNumber: n, serialNumber: `26270010${n}`, orderId: 'so-1002', lineItemId: 'li-1002-be', itemName: 'Bucket Elevator', sku: 'BSM-BE-1200', customerName: 'Delhi Packaging Co.', salesOrderNumber: 'SO-1002', deliveryDate: '25/07/2026', status: n <= 2 ? 'Media Done' : 'Not Generated', selectedForBatch: n <= 2, woodenPacking: 'Not Required', qrPasted: n <= 2, qcDone: n <= 2, mediaPhotos: n <= 2 ? 2 : 0, mediaVideos: n <= 2 ? 1 : 0 })),
  },
  {
    id: 'so-1003', zohoSalesOrderId: 'z-so-1003', salesOrderNumber: 'SO-1003', status: 'open', customerName: 'Mumbai Foods LLP', customerEmail: 'stores@mumbaifoods.in', customerPhone: '+91 98100 10003', shippingAddress: 'Bhiwandi, Maharashtra', salesperson: 'Amit Bansal', deliveryDate: '29/07/2026', dashboardStatus: 'Dispatched', reviewRequired: false,
    lineItems: [{ id: 'li-1003-rt', itemName: 'Rotary Table', sku: 'BSM-RT-600', quantity: 1, pendingQuantity: 1, woodenPackingRequired: true }],
    machines: [unit({ unitNumber: 1, serialNumber: '262700005', orderId: 'so-1003', lineItemId: 'li-1003-rt', itemName: 'Rotary Table', sku: 'BSM-RT-600', customerName: 'Mumbai Foods LLP', salesOrderNumber: 'SO-1003', deliveryDate: '29/07/2026', status: 'Dispatched', selectedForBatch: true, woodenPacking: 'Completed', qrPasted: true, qcDone: true, mediaPhotos: 3, mediaVideos: 1, vehicleNumber: 'DL 1 AB 7731', warrantyStart: '10/07/2026', warrantyEnd: warrantyEnd('2026-07-10') })],
  },
]

export const machines: MachineUnit[] = orders.flatMap((order) => order.machines)
export const packagingQueue = machines.filter((m) => ['Processed', 'Packing Done'].includes(m.status) && m.serialNumber && m.qrToken)
export const mediaQueue = machines.filter((m) => m.status === 'Packing Done')
export const vehicleQueue = machines.filter((m) => m.status === 'Media Done')
