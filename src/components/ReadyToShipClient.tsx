'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from './DashboardShell'
import { PaymentStatusChip } from './PaymentStatusChip'
import { normalizeSalesOrderNumber, type ProjectedPaymentStatus } from '@/lib/payment-status-projection'
import type { ReadyToShipItem, Transporter } from '@/lib/ready-to-ship'

function formatDate(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function todayInputDate() { return new Date().toISOString().slice(0, 10) }

export function ReadyToShipClient({ initialItems, initialTransporters }: { initialItems: ReadyToShipItem[]; initialTransporters: Transporter[] }) {
  const [items, setItems] = useState(initialItems)
  const [transporters, setTransporters] = useState(initialTransporters)
  const [activeItem, setActiveItem] = useState<ReadyToShipItem | null>(null)
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState('')
  const [showAddTransporter, setShowAddTransporter] = useState(false)
  const [editingTransporter, setEditingTransporter] = useState<Transporter | null>(null)
  const [paymentBySalesOrder, setPaymentBySalesOrder] = useState<Record<string, ProjectedPaymentStatus>>({})
  const refreshPaymentProjection = useCallback(async () => {
    try {
      const response = await fetch('/api/payment-status-projection', { cache: 'no-store' })
      if (!response.ok) return
      const json = await response.json()
      if (json?.bySalesOrder && typeof json.bySalesOrder === 'object') setPaymentBySalesOrder(json.bySalesOrder)
    } catch { /* Display-only and deliberately independent of shipment data/actions. */ }
  }, [])
  const paymentStatus = (item: ReadyToShipItem) => paymentBySalesOrder[normalizeSalesOrderNumber(item.salesOrderNumber)]

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => [item.salesOrderNumber, item.customerName, item.shippingAddress, item.machines.map((machine) => `${machine.itemName} ${machine.serialNumber}`).join(' '), item.shipment?.vehicleNumber].join(' ').toLowerCase().includes(q))
  }, [items, query])

  async function refresh(options: { sync?: boolean; silent?: boolean } = {}) {
    if (!options.silent) { setBusy(options.sync ? 'sync' : 'refresh'); setMessage('') }
    try {
      if (options.sync) {
        const syncResponse = await fetch('/api/cron/sync-orders', { method: 'POST', cache: 'no-store' })
        const syncJson = await syncResponse.json()
        if (!syncResponse.ok || !syncJson.ok) throw new Error(syncJson.error || 'Could not sync orders')
      }
      const response = await fetch('/api/ready-to-ship', { cache: 'no-store' })
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error || 'Could not refresh Ready to Ship')
      setItems(json.data.items || [])
      setTransporters(json.data.transporters || [])
      void refreshPaymentProjection()
    } catch (error) { if (!options.silent) setMessage(error instanceof Error ? error.message : 'Could not refresh Ready to Ship') }
    finally { if (!options.silent) setBusy('') }
  }

  useEffect(() => {
    void refreshPaymentProjection()
    const interval = window.setInterval(() => { void refresh({ sync: true, silent: true }) }, 15 * 60 * 1000)
    const focus = () => void refreshPaymentProjection()
    window.addEventListener('focus', focus)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', focus) }
  }, [refreshPaymentProjection])

  async function addNewTransporter(event: React.FormEvent) {
    event.preventDefault()
    setBusy('add'); setMessage('')
    try {
      const response = await fetch('/api/ready-to-ship', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'add_transporter', name, phone, notes }) })
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error || 'Could not add transporter')
      setTransporters((prev) => [...prev, json.data.transporter])
      setName(''); setPhone(''); setNotes('')
      setShowAddTransporter(false)
      setMessage('Transporter added.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not add transporter') }
    finally { setBusy('') }
  }


  async function saveTransporterEdit(event: React.FormEvent) {
    event.preventDefault()
    if (!editingTransporter) return
    setBusy('edit-transporter'); setMessage('')
    try {
      const response = await fetch('/api/ready-to-ship', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'update_transporter', id: editingTransporter.id, name: editingTransporter.name, phone: editingTransporter.phone, notes: editingTransporter.notes }) })
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error || 'Could not update transporter')
      setTransporters((prev) => prev.map((item) => item.id === json.data.transporter.id ? json.data.transporter : item))
      setEditingTransporter(null)
      setMessage('Transporter updated.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update transporter') }
    finally { setBusy('') }
  }

  async function deleteEditingTransporter() {
    if (!editingTransporter || !window.confirm('Delete this transporter?')) return
    setBusy('delete-transporter'); setMessage('')
    try {
      const response = await fetch('/api/ready-to-ship', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'delete_transporter', id: editingTransporter.id }) })
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error || 'Could not delete transporter')
      setTransporters((prev) => prev.filter((item) => item.id !== editingTransporter.id))
      setEditingTransporter(null)
      setMessage('Transporter deleted.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not delete transporter') }
    finally { setBusy('') }
  }


  return <section className="ready-ship-page">
    <div className="ready-ship-hero card">
      <div>
        <h1>Ready to Ship</h1>
      </div>
      <div className="ready-ship-stats">
        <strong>{items.filter((item) => !item.shipment).length}</strong>
        <span>pending shipment</span>
      </div>
    </div>

    {message && <div className={message.includes('added') ? 'form-success' : 'form-error'}>{message}</div>}

    <div className="ready-ship-layout">
      <section className="card ready-machine-panel">
        <div className="ready-panel-head">
          <div><h2>Ready Orders</h2></div>
          <button className={`ready-sync-btn ${busy === 'sync' ? 'spinning' : ''}`} type="button" aria-label="Sync orders" title="Sync orders" disabled={busy === 'sync'} onClick={() => refresh({ sync: true })}>↻</button>
        </div>
        <input className="ready-search" placeholder="Search SO, customer, address, machine, serial, vehicle" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="ready-machine-list">
          {filtered.map((item) => { const needsBuilty = item.shipment?.shipmentType === 'transporter' && !item.shipment.lrCopy?.url; return <article className={`ready-machine-card ${item.shipment ? 'shipped' : ''} ${needsBuilty ? 'builty-needed' : ''}`} key={item.id}>
            <div className="ready-machine-main">
              <div><strong>{item.salesOrderNumber}</strong><span>{item.customerName}</span></div>
              <div className="ready-status-cluster"><Badge tone={needsBuilty ? 'red' : item.shipment ? 'blue' : 'green'}>{needsBuilty ? 'Builty Needed' : item.shipment ? 'Shipped' : 'Machine Packed'}</Badge><PaymentStatusChip status={paymentStatus(item)} /></div>
            </div>
            <div className="ready-customer-address">{item.shippingAddress || 'Address not available'}</div>
            <div className="ready-machine-list-inline">{item.machines.map((machine) => { const videos = item.machineVideos?.[machine.id] || []; return <div className="ready-machine-line" key={machine.id}><div className="ready-machine-line-main"><strong>{machine.itemName}</strong><span>Qty 1</span>{machine.serialNumber && <em>Serial {machine.serialNumber}</em>}</div>{videos.length > 0 && <div className="ready-machine-video-links">{videos.map((video, index) => <a className="ready-item-video-link" href={video.workdriveUrl || video.url} target="_blank" key={video.id}>View Video{videos.length > 1 ? ` ${index + 1}` : ''}</a>)}</div>}</div>})}</div>
            <div className="ready-machine-meta">
              <span>Machines: {item.machines.length}</span>
              <span>{item.shipment ? `Vehicle: ${item.shipment.vehicleNumber}` : `Ready: ${formatDate(item.readyAt || item.completedAt)}`}</span>
              <span className={item.packingVideoUploaded ? 'packing-video-yes' : 'packing-video-no'}>{item.packingVideoUploaded ? '✅' : '⚠️'} Packaging Video: {item.packingVideoUploaded ? 'Yes' : 'No'}</span>
            </div>
            <div className="ready-machine-actions">
              <div />
              <div className="ready-action-buttons"><button className="btn red" type="button" onClick={() => setActiveItem(item)}>{needsBuilty ? 'Upload LR' : item.shipment ? 'View Shipment' : 'Ship'}</button></div>
            </div>
          </article>})}
          {!filtered.length && <div className="empty-state"><strong>No dispatch-completed orders yet</strong><span className="muted">Orders will appear here once completed from Dispatch View.</span></div>}
        </div>
      </section>

      <aside className="card transporter-panel">
        <div className="ready-panel-head"><div><h2>Transporters</h2></div><button className="btn red" type="button" onClick={() => setShowAddTransporter(true)}>Add</button></div>
        {showAddTransporter && <form className="transporter-form" onSubmit={addNewTransporter}>
          <input placeholder="Transporter / partner name" value={name} onChange={(event) => setName(event.target.value)} />
          <input placeholder="Phone number" value={phone} onChange={(event) => setPhone(event.target.value)} />
          <input placeholder="Notes / route / vehicle type" value={notes} onChange={(event) => setNotes(event.target.value)} />
          <div className="transporter-form-actions"><button className="btn light" type="button" onClick={() => setShowAddTransporter(false)}>Cancel</button><button className="btn red" disabled={busy === 'add'}>{busy === 'add' ? 'Adding…' : 'Save'}</button></div>
        </form>}
        <div className="transporter-list">
          {transporters.map((item) => <article className="transporter-card" key={item.id}>
            <div><strong>{item.name}</strong><a href={`tel:${item.phone}`}>{item.phone}</a>{item.notes && <span>{item.notes}</span>}</div>
            <button type="button" className="transporter-edit-btn" aria-label={`Edit ${item.name}`} title="Edit transporter" onClick={() => setEditingTransporter(item)}>✎</button>
          </article>)}
          {!transporters.length && <div className="empty-state small"><strong>No transporters yet</strong></div>}
        </div>
      </aside>
    </div>
    {editingTransporter && <div className="modal-backdrop media-modal-backdrop" role="dialog" aria-modal="true"><section className="order-modal card transporter-edit-modal"><div className="modal-head"><div><h1>Edit Transporter</h1><p className="muted">Change name, phone or notes</p></div><button className="drawer-close" onClick={() => setEditingTransporter(null)}>×</button></div><form className="transporter-edit-form" onSubmit={saveTransporterEdit}><label>Name<input value={editingTransporter.name} onChange={(event) => setEditingTransporter({ ...editingTransporter, name: event.target.value })} /></label><label>Phone<input value={editingTransporter.phone} onChange={(event) => setEditingTransporter({ ...editingTransporter, phone: event.target.value })} /></label><label>Notes<input value={editingTransporter.notes || ''} onChange={(event) => setEditingTransporter({ ...editingTransporter, notes: event.target.value })} placeholder="Notes / route / vehicle type" /></label><div className="transporter-edit-actions"><button className="btn light" type="button" onClick={() => setEditingTransporter(null)}>Cancel</button><button className="btn red" type="submit" disabled={busy === 'edit-transporter'}>{busy === 'edit-transporter' ? 'Saving…' : 'Save Changes'}</button><button className="btn light danger-text" type="button" disabled={busy === 'delete-transporter'} onClick={deleteEditingTransporter}>{busy === 'delete-transporter' ? 'Deleting…' : 'Delete'}</button></div></form></section></div>}
    {activeItem && <ShipmentModal item={activeItem} paymentStatus={paymentStatus(activeItem)} transporters={transporters} busy={busy} setBusy={setBusy} onClose={() => setActiveItem(null)} onSaved={(updated) => { const stillNeedsBuilty = updated.shipment?.shipmentType === 'transporter' && !updated.shipment.lrCopy?.url; setItems((prev) => stillNeedsBuilty ? prev.map((item) => item.id === updated.id ? updated : item) : prev.filter((item) => item.id !== updated.id)); setActiveItem(null); setMessage(stillNeedsBuilty ? 'Shipment saved. Builty/LR still needed.' : 'Shipment saved.') }} />}
  </section>
}

function ShipmentModal({ item, paymentStatus, transporters, busy, setBusy, onClose, onSaved }: { item: ReadyToShipItem; paymentStatus?: ProjectedPaymentStatus; transporters: Transporter[]; busy: string; setBusy: (value: string) => void; onClose: () => void; onSaved: (item: ReadyToShipItem) => void }) {
  const existing = item.shipment
  const dropdownTransporters = [...transporters, { id: 'special-porter', name: 'Porter', phone: '', notes: '', createdAt: '' }, { id: 'special-customer-own-transport', name: "Customer's Own Transport", phone: '', notes: '', createdAt: '' }]
  const [shipmentType, setShipmentType] = useState<'direct' | 'transporter'>(existing?.shipmentType || 'direct')
  const [transporterName, setTransporterName] = useState(existing?.transporterName || '')
  const selectedTransporter = dropdownTransporters.find((entry) => entry.name === transporterName)
  const [transporterPhone, setTransporterPhone] = useState(existing?.transporterPhone || selectedTransporter?.phone || '')
  const [vehicleNumber, setVehicleNumber] = useState(existing?.vehicleNumber && existing.vehicleNumber !== '—' ? existing.vehicleNumber : '')
  const [driverPhone, setDriverPhone] = useState(existing?.driverPhone && existing.driverPhone !== '—' ? existing.driverPhone : '')
  const [expectedDelivery, setExpectedDelivery] = useState(existing?.expectedDelivery || todayInputDate())
  const [notes, setNotes] = useState(existing?.notes || '')
  const [lrFile, setLrFile] = useState<File | null>(null)
  const [lrCopy, setLrCopy] = useState(existing?.lrCopy || null)
  const [error, setError] = useState('')

  async function uploadLrCopy() {
    if (!lrFile) return lrCopy
    const type = lrFile.type || 'application/octet-stream'
    if (!type.startsWith('image/') && type !== 'application/pdf') throw new Error('Attach only image or PDF for Builty/LR copy')
    const targetResponse = await fetch('/api/r2/upload-target', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId: item.orderId, machineId: 'shipment-lr-builty', name: lrFile.name, type, size: lrFile.size, stage: 'shipment' }) })
    const targetJson = await targetResponse.json()
    if (!targetResponse.ok || !targetJson.ok) throw new Error(targetJson.error || 'Could not prepare LR upload')
    const target = targetJson.data
    const uploadResponse = await fetch(target.uploadUrl, { method: 'PUT', headers: { 'content-type': type }, body: lrFile })
    if (uploadResponse.ok) return { name: lrFile.name, type, url: target.publicUrl, r2Key: target.key, expiresAt: target.expiresAt || null }
    const form = new FormData()
    form.append('orderId', item.orderId)
    form.append('machineId', 'shipment-lr-builty')
    form.append('stage', 'shipment')
    form.append('file', lrFile)
    const fallbackResponse = await fetch('/api/media-proof/upload', { method: 'POST', body: form })
    const fallbackJson = await fallbackResponse.json()
    if (!fallbackResponse.ok || !fallbackJson.ok) throw new Error(fallbackJson.error || 'Could not upload Builty/LR copy')
    return fallbackJson.data.file
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy('shipment'); setError('')
    try {
      const uploadedLrCopy = shipmentType === 'transporter' ? await uploadLrCopy() : null
      const response = await fetch('/api/ready-to-ship', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'process_shipment', itemId: item.id, shipmentType, transporterName, transporterPhone, vehicleNumber: shipmentType === 'direct' ? vehicleNumber : '', driverName: '—', driverPhone: shipmentType === 'direct' ? driverPhone : '', expectedDelivery, notes, lrCopy: uploadedLrCopy }) })
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error || 'Could not save shipment')
      onSaved({ ...item, shipment: json.data.shipment })
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save shipment') }
    finally { setBusy('') }
  }

  return <div className="modal-backdrop media-modal-backdrop" role="dialog" aria-modal="true"><section className="order-modal card shipment-modal">
    <div className="modal-head"><div><h1>{item.salesOrderNumber}</h1><p className="muted">{item.customerName}</p><PaymentStatusChip status={paymentStatus} /></div><button className="drawer-close" onClick={onClose}>×</button></div>
    <div className="shipment-order-context"><strong>{item.shippingAddress || 'Address not available'}</strong><div>{item.machines.map((machine) => <span key={machine.id}>{machine.itemName} · Qty 1{machine.serialNumber ? ` · Serial ${machine.serialNumber}` : ''}</span>)}</div><em>{item.packingVideoUploaded ? '✅' : '⚠️'} Packaging Video: {item.packingVideoUploaded ? 'Yes' : 'No'}</em></div>
    <div className="shipment-type-selector"><button type="button" className={shipmentType === 'direct' ? 'active' : ''} onClick={() => setShipmentType('direct')}>Direct</button><button type="button" className={shipmentType === 'transporter' ? 'active' : ''} onClick={() => setShipmentType('transporter')}>Via Transport</button></div>
    {error && <div className="form-error">{error}</div>}
    {existing && <div className="shipment-status-box"><strong>Shipment already saved</strong><span>{existing.transporterName}</span><span>{existing.vehicleNumber}</span></div>}
    <form className="shipment-form" onSubmit={submit}>
      {shipmentType === 'direct' ? <>
        <label>Dispatch Partner<select value={transporterName} onChange={(event) => { setTransporterName(event.target.value); const next = dropdownTransporters.find((entry) => entry.name === event.target.value); setTransporterPhone(next?.phone || '') }}><option value="">Select transporter</option>{dropdownTransporters.map((entry) => <option key={entry.id} value={entry.name}>{entry.name}</option>)}</select></label>
        <label>Expected Delivery<input type="date" value={expectedDelivery} onChange={(event) => setExpectedDelivery(event.target.value)} /></label>
        <label>Vehicle Number <span className="optional-field">Optional</span><input value={vehicleNumber} onChange={(event) => setVehicleNumber(event.target.value.toUpperCase())} placeholder="DL 01 AB 1234" /></label>
        <label>Driver Mobile <span className="optional-field">Optional</span><input value={driverPhone} onChange={(event) => setDriverPhone(event.target.value)} /></label>
        <label className="shipment-notes">Notes<input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional dispatch note" /></label>
      </> : <>
        <label>Transporter Name<input value={transporterName} onChange={(event) => setTransporterName(event.target.value)} placeholder="Transporter name" /></label>
        <label>Transporter Number <span className="optional-field">Optional</span><input value={transporterPhone} onChange={(event) => setTransporterPhone(event.target.value)} placeholder="Transporter number" /></label>
        <label className="shipment-notes shipment-file-field">Attach Builty/LR Copy<input type="file" accept="image/*,application/pdf" onChange={(event) => setLrFile(event.target.files?.[0] || null)} />{(lrFile || lrCopy) && <span>{lrFile?.name || lrCopy?.name}</span>}</label>
      </>}
      <div className="shipment-actions"><button className="btn light" type="button" onClick={onClose}>Cancel</button><button className="btn red" disabled={busy === 'shipment'}>{busy === 'shipment' ? 'Saving…' : existing ? 'Update Shipment' : 'Confirm Shipment'}</button></div>
    </form>
  </section></div>
}

