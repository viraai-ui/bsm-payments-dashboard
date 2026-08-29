'use client'

import { useMemo, useState } from 'react'
import { Badge } from '@/components/DashboardShell'
import type { Order } from '@/types/domain'
import type { MediaProofRecord, MediaUpload } from '@/lib/media-proof'
import { LOADING_ORDER_UNIT_ID } from '@/lib/media-proof'
import type { OrderStatusProjection } from '@/lib/status-projection'
import type { ShipmentRecord } from '@/lib/ready-to-ship'

type WarrantyInfo = { label: 'Warranty Valid' | 'Warranty Void'; tone: 'green' | 'red'; startLabel: string; endLabel: string }
type DatabaseFilter = 'all' | 'pending' | 'submitted' | 'closed' | 'builty'
const MAX_VISIBLE_ROWS = 50

export function DatabaseClient({ orders = [], mediaRecords = {}, packingMediaRecords = {}, loadingMediaRecords = {}, statuses = {}, warrantyDates = {}, shipmentRecords = {}, publicMode = false }: { orders?: Order[]; mediaRecords?: Record<string, MediaProofRecord>; packingMediaRecords?: Record<string, MediaProofRecord>; loadingMediaRecords?: Record<string, MediaProofRecord>; statuses?: Record<string, OrderStatusProjection>; warrantyDates?: Record<string, string>; shipmentRecords?: Record<string, ShipmentRecord>; publicMode?: boolean }) {
  const [draftQuery, setDraftQuery] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<DatabaseFilter>('all')
  const [active, setActive] = useState<Order | null>(null)

  const searchableOrders = useMemo(() => orders.map((order) => {
    const warranty = warrantyInfo(warrantyDates[order.id])
    const shipment = shipmentRecords[order.id]
    const salesOrderDigits = digitsOnly(order.salesOrderNumber)
    const haystack = [
      order.salesOrderNumber,
      normalizeSearchText(order.salesOrderNumber),
      salesOrderDigits,
      salesOrderDigits.replace(/^0+/, ''),
      order.customerName,
      order.salesperson,
      order.deliveryDate,
      statuses[order.id]?.lifecycleLabel,
      statuses[order.id]?.mediaLabel,
      warranty.label,
      warranty.startLabel,
      warranty.endLabel,
      shipment?.transporterName,
      shipment?.transporterPhone,
      shipment?.vehicleNumber,
      shipment?.driverName,
      shipment?.driverPhone,
      ...order.machines.map((machine) => `${machine.serialNumber} ${digitsOnly(machine.serialNumber || '')} ${machine.itemName} ${machine.vendor || ''}`),
    ].join(' ').toLowerCase()
    return { order, haystack }
  }), [orders, statuses, warrantyDates, shipmentRecords])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const normalizedNeedle = normalizeSearchText(needle)
    const digitNeedle = digitsOnly(needle)
    return searchableOrders
      .filter((item) => {
        if (!needle) return true
        return item.haystack.includes(needle) || Boolean(normalizedNeedle && item.haystack.includes(normalizedNeedle)) || Boolean(digitNeedle && item.haystack.includes(digitNeedle))
      })
      .filter((item) => matchesDatabaseFilter(item.order, statuses[item.order.id], shipmentRecords[item.order.id], filter))
      .map((item) => item.order)
  }, [query, searchableOrders, statuses, shipmentRecords, filter])

  const visibleRows = useMemo(() => filtered.slice(0, MAX_VISIBLE_ROWS), [filtered])
  const hiddenCount = Math.max(0, filtered.length - visibleRows.length)

  return <div className={publicMode ? 'public-database-view' : undefined}>
    <section className="card search-panel database-search-panel"><div className="database-search-input-wrap"><input placeholder="Search SO, serial, customer…" value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') setQuery(draftQuery) }} />{draftQuery && <button className="database-clear-x" aria-label="Clear search" onClick={() => { setDraftQuery(''); setQuery('') }}>×</button>}</div><button className="btn" onClick={() => setQuery(draftQuery)}>Search</button>{hiddenCount > 0 && <span className="database-result-note">Showing first {MAX_VISIBLE_ROWS}. Search serial/customer to narrow.</span>}</section>
    <section className="card database-list-card"><div className="database-list-head"><h2>Database</h2><label className="database-filter-wrap"><span>Filter</span><select value={filter} onChange={(event) => setFilter(event.target.value as DatabaseFilter)} aria-label="Filter database records"><option value="all">All Records</option><option value="pending">Pending</option><option value="submitted">Media Submitted</option><option value="closed">Closed</option><option value="builty">Builty Uploaded</option></select></label></div><div className="desktop-table table-wrap"><table className="table"><thead><tr><th>SO</th><th>Customer</th><th>Units</th><th>Warranty Valid Till</th><th>Media</th><th>Action</th></tr></thead><tbody>{visibleRows.map((order) => { const status = statuses[order.id]; const warranty = warrantyInfo(warrantyDates[order.id]); const builtyUploaded = Boolean(shipmentRecords[order.id]?.lrCopy?.url); return <tr key={order.id}><td><strong>{order.salesOrderNumber}</strong></td><td><div className="database-customer-stack"><span>{order.customerName}</span>{builtyUploaded && <span className="database-builty-chip">Builty Uploaded</span>}</div></td><td>{order.machines.length}</td><td><strong className="warranty-date-cell">{warranty.endLabel}</strong></td><td><Badge tone={status?.mediaTone || 'gray'}>{status?.mediaLabel || 'No Media'}</Badge></td><td><button className="btn light" onClick={() => setActive(order)}>View</button></td></tr> })}</tbody></table></div><div className="mobile-cards">{visibleRows.map((order) => { const status = statuses[order.id]; const warranty = warrantyInfo(warrantyDates[order.id]); const builtyUploaded = Boolean(shipmentRecords[order.id]?.lrCopy?.url); return <article className="card mobile-order-card database-mobile-card mobile-order-tap-card compact-operational-card" key={order.id} onClick={() => setActive(order)}><div className="compact-card-main"><strong>{order.salesOrderNumber}</strong><p className="muted">{order.customerName}</p><div className="database-mobile-chip-row"><Badge tone={warranty.tone}>{warranty.endLabel}</Badge>{builtyUploaded && <span className="database-builty-chip">Builty Uploaded</span>}</div></div><div className="compact-card-side"><div><span>Units</span><strong>{order.machines.length}</strong></div><div><span>Media</span><strong>{status?.mediaLabel || 'No Media'}</strong></div><button className="btn light compact-view-btn" onClick={(event) => { event.stopPropagation(); setActive(order) }}>View</button></div></article> })}</div>{!visibleRows.length && <p className="empty-note">No records found for this search/filter.</p>}</section>
    {active && <RecordModal order={active} media={packingMediaRecords[active.id] || mediaRecords[active.id]} loadingMedia={loadingMediaRecords[active.id]} status={statuses[active.id]} warrantyDate={warrantyDates[active.id]} shipment={shipmentRecords[active.id]} onClose={() => setActive(null)} />}
  </div>
}

function matchesDatabaseFilter(order: Order, status: OrderStatusProjection | undefined, shipment: ShipmentRecord | undefined, filter: DatabaseFilter) {
  const media = (status?.mediaLabel || '').toLowerCase()
  const lifecycle = (status?.lifecycleLabel || '').toLowerCase()
  if (filter === 'all') return true
  if (filter === 'builty') return Boolean(shipment?.lrCopy?.url)
  if (filter === 'closed') return media === 'closed' || lifecycle === 'closed'
  if (filter === 'submitted') return media === 'submitted' || media === 'media submitted'
  if (filter === 'pending') return media === 'pending' || media === 'no media' || (!media && !shipment?.lrCopy?.url && order.machines.length > 0)
  return true
}

function RecordModal({ order, media, loadingMedia, status, warrantyDate, shipment, onClose }: { order: Order; media?: MediaProofRecord; loadingMedia?: MediaProofRecord; status?: OrderStatusProjection; warrantyDate?: string; shipment?: ShipmentRecord; onClose: () => void }) {
  const warranty = warrantyInfo(warrantyDate)
  const vendors = [...new Set(order.machines.map((machine) => formatVendor(machine.vendor || '')).filter(Boolean))].join(', ')
  const loadingVideos = loadingMedia?.units?.[LOADING_ORDER_UNIT_ID]?.videos || []
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="order-modal card"><div className="modal-head"><div><h1>{order.salesOrderNumber}</h1><p className="muted">{order.customerName}</p></div><button className="drawer-close" onClick={onClose}>×</button></div>
    <div className="grid two details-grid"><Info k="Order Stage" v={status?.lifecycleLabel || 'Open'} /><Info k="Media" v={status?.mediaLabel || 'No Media'} /><Info k="Warranty Until" v={warranty.endLabel} /><Info k="Warranty Status" v={warranty.label} /><Info k="Customer" v={order.customerName} /><Info k="Salesperson" v={order.salesperson || '—'} /><Info k="Address" v={order.shippingAddress || '—'} /><Info k="Delivery" v={formatDisplayDate(order.deliveryDate)} />{vendors && <Info k="Vendor" v={vendors} />}</div>
    <section className="modal-section"><h2>Units & Media</h2><div className="desktop-table table-wrap"><table className="table database-units-table"><thead><tr><th>Unit</th><th>Serial</th><th>Vendor</th><th>Warranty</th><th>Valid Until</th><th>Videos</th></tr></thead><tbody>{order.machines.map((machine) => <tr key={machine.id}><td className="database-unit-name">{machine.itemName}</td><td>{machine.serialNumber || '—'}</td><td>{formatVendor(machine.vendor || '')}</td><td><Badge tone={warranty.tone}>{warranty.label === 'Warranty Valid' ? '✓ Warranty Valid' : warranty.label}</Badge></td><td>{warranty.endLabel}</td><td><VideoButtons files={media?.units?.[machine.id]?.videos || []} label="View Video" /></td></tr>)}</tbody></table></div><div className="mobile-cards database-unit-cards">{order.machines.map((machine) => <article className="card mobile-order-card" key={machine.id}><strong>{machine.itemName}</strong><p className="muted">Serial: {machine.serialNumber || '—'}</p><div className="meta-grid"><div><span>Vendor</span><strong>{formatVendor(machine.vendor || '')}</strong></div><div><span>Warranty</span><strong><Badge tone={warranty.tone}>{warranty.label === 'Warranty Valid' ? '✓ Valid' : warranty.label}</Badge></strong></div><div><span>Valid Until</span><strong>{warranty.endLabel}</strong></div><div><span>Videos</span><strong><VideoButtons files={media?.units?.[machine.id]?.videos || []} label="View Video" /></strong></div></div></article>)}</div></section>
    {(shipment || loadingVideos.length > 0) && <section className="modal-section database-shipment-section"><h2>Dispatch Details</h2><div className="grid two details-grid">{shipment && <><Info k="Shipment Type" v={shipment.shipmentType === 'transporter' ? 'Transporter' : 'Direct'} /><Info k="Transporter Name" v={shipment.transporterName || '—'} /><Info k="Transporter Number" v={shipment.transporterPhone || '—'} /></>}<Info k="Loading Video" v={<VideoButtons files={loadingVideos} label="View Loading Video" />} />{shipment?.shipmentType !== 'transporter' && shipment && <><Info k="Vehicle Number" v={shipment.vehicleNumber || '—'} /><Info k="Driver Mobile" v={shipment.driverPhone || '—'} /><Info k="Expected Delivery" v={formatDisplayDate(shipment.expectedDelivery)} /></>}{shipment?.lrCopy?.url && <Info k="Builty/LR Copy" v={<a className="btn light database-video-btn" href={shipment.lrCopy.url} target="_blank" rel="noreferrer">View Builty</a>} />}{shipment?.notes && <Info k="Notes" v={shipment.notes} />}</div></section>}
  </section></div>
}

function VideoButtons({ files, label }: { files: MediaUpload[]; label: string }) {
  const videos = files.filter((file) => file.url || file.workdriveUrl)
  if (!videos.length) return <span className="muted">No videos yet</span>
  return <div className="database-video-actions">{videos.map((file, index) => <a key={file.id} className="btn light database-video-btn" href={file.workdriveUrl || file.url} target="_blank" rel="noreferrer">{videos.length > 1 ? `${label} ${index + 1}` : label}</a>)}</div>
}

function normalizeSearchText(value?: string) { return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '') }
function digitsOnly(value?: string) { return String(value || '').replace(/\D/g, '') }

function warrantyInfo(value?: string): WarrantyInfo {
  const start = parseDate(value)
  if (!start) return { label: 'Warranty Void', tone: 'red', startLabel: '—', endLabel: '—' }
  const end = new Date(start)
  end.setMonth(end.getMonth() + 13)
  end.setHours(23, 59, 59, 999)
  const valid = Date.now() <= end.getTime()
  return { label: valid ? 'Warranty Valid' : 'Warranty Void', tone: valid ? 'green' : 'red', startLabel: formatDate(start), endLabel: formatDate(end) }
}

function parseDate(value?: string) {
  if (!value) return null
  const text = String(value).replace(/^'/, '').trim()
  if (!text) return null
  if (/^\d{4,6}$/.test(text)) return excelSerialToDate(Number(text))
  const monthMatch = text.match(/^(\d{1,2})[-\s/]([a-z]{3,9})[-\s/](\d{2,4})$/i)
  if (monthMatch) {
    const [, dd, mon, yy] = monthMatch
    const month = monthNumber(mon)
    const year = Number(yy.length === 2 ? `20${yy}` : yy)
    return month ? safeDate(year, month, Number(dd)) : null
  }
  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (isoMatch) return safeDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (match) {
    const [, mm, dd, yy] = match
    const year = Number(yy.length === 2 ? `20${yy}` : yy)
    return safeDate(year, Number(mm), Number(dd))
  }
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? new Date(parsed) : null
}

function excelSerialToDate(serial: number) {
  const epoch = Date.UTC(1899, 11, 30)
  const date = new Date(epoch + serial * 24 * 60 * 60 * 1000)
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function safeDate(year: number, month: number, day: number) {
  const parsed = new Date(year, month - 1, day)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function monthNumber(value: string) { return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(value.slice(0, 3).toLowerCase()) + 1 }
function formatVendor(value: string) { return value.trim().toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase()) }
function formatDate(date: Date) { return `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}` }
function formatDisplayDate(value?: string) {
  const date = parseDate(value)
  return date ? formatDate(date) : value || '—'
}

function Info({ k, v }: { k: string; v: React.ReactNode }) { return <div className="info-tile"><span>{k}</span><strong>{v}</strong></div> }
