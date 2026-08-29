'use client'

import QRCode from 'qrcode'
import { jsPDF } from 'jspdf'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/DashboardShell'
import { PaymentStatusChip } from '@/components/PaymentStatusChip'
import { normalizeSalesOrderNumber, type ProjectedPaymentStatus } from '@/lib/payment-status-projection'
import { dispatchCategoryLabel } from '@/lib/item-classification'
import type { MachineUnit, Order } from '@/types/domain'
import type { MachineWorkflow, OrderWorkflow } from '@/lib/workflow-store'
import { safeLocalStorageRemove, safeLocalStorageSet } from '@/lib/safe-local-storage'

type OrderStage = 'open' | 'processed' | 'packed' | 'packing_video' | 'loading_video' | 'closed'

const ORDERS_CACHE_KEY = 'bsm.orders.cache.v2'
const MACHINE_DB_KEY = 'bsm.machine.database.v1'
const PROCESSED_ORDERS_KEY = 'bsm.processed.orders.v1'
const ORDERS_AUTO_SYNC_MS = 15 * 60 * 1000

export function OrdersClient({ orders, live = false }: { orders: Order[]; live?: boolean }) {
  const [rows, setRows] = useState<Order[]>(orders)
  const [active, setActive] = useState<Order | null>(null)
  const [activeStage, setActiveStage] = useState<OrderStage>('open')
  const [activeWorkflow, setActiveWorkflow] = useState<OrderWorkflow | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const syncingRef = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [workflowByOrder, setWorkflowByOrder] = useState<Record<string, OrderWorkflow>>({})
  const [stageByOrder, setStageByOrder] = useState<Record<string, OrderStage>>({})
  const [statusFilter, setStatusFilter] = useState<OrderStage | 'all'>('all')
  const [paymentBySalesOrder, setPaymentBySalesOrder] = useState<Record<string, ProjectedPaymentStatus>>({})

  const refreshPaymentProjection = useCallback(async () => {
    try {
      const response = await fetch('/api/payment-status-projection', { cache: 'no-store' })
      if (!response.ok) return
      const json = await response.json()
      if (json?.bySalesOrder && typeof json.bySalesOrder === 'object') setPaymentBySalesOrder(json.bySalesOrder)
    } catch { /* Display-only enrichment: operational behavior must fail open. */ }
  }, [])
  const paymentStatus = (order: Order) => paymentBySalesOrder[normalizeSalesOrderNumber(order.salesOrderNumber)]

  useEffect(() => {
    // Migrate the obsolete cache that duplicated full orders and base64 QR images.
    // Durable workflow storage remains the sole source of truth.
    safeLocalStorageRemove(MACHINE_DB_KEY)
    const cached = readCachedOrders()
    if (cached.length) setRows(cached)
    void fetch('/api/workflow/processed').then((r) => r.json()).then((json) => {
      const map: Record<string, OrderWorkflow> = {}
      for (const item of json.data?.orders || []) map[item.salesOrderId] = item
      setWorkflowByOrder(map)
    }).catch(() => {})
    void refreshPaymentProjection()
    if (live) void loadOrders(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, refreshPaymentProjection])

  useEffect(() => {
    const focus = () => void refreshPaymentProjection()
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [refreshPaymentProjection])

  useEffect(() => {
    const timer = window.setInterval(() => { void syncOrders(false) }, ORDERS_AUTO_SYNC_MS)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadOrders = async (showErrors = true) => {
    setError(''); setNotice('')
    try {
      const response = await fetch('/api/orders', { cache: 'no-store' })
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error || 'Could not load saved orders')
      const nextRows = sanitizeOrders(json.data?.orders || [])
      setStageByOrder(json.data?.stages || {})
      setRows(nextRows); cacheOrders(nextRows); setLastSyncAt(json.data?.lastSuccessfulSyncAt || null)
      void refreshPaymentProjection()
    } catch (err) { if (showErrors) setError(err instanceof Error ? err.message : 'Could not load saved orders') }
  }

  const syncOrders = async (showErrors = true) => {
    if (showErrors && !window.confirm('Sync confirmed orders from Zoho now?')) return
    if (syncingRef.current) return
    setError(''); setNotice('')
    syncingRef.current = true
    setSyncing(true)
    try {
      const response = await fetch('/api/orders', { method: 'POST', cache: 'no-store' })
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error || 'Could not sync Zoho orders')
      const nextRows = sanitizeOrders(json.data?.orders || [])
      setStageByOrder(json.data?.stages || {})
      setRows(nextRows)
      cacheOrders(nextRows)
      setLastSyncAt(json.data?.lastSuccessfulSyncAt || null)
      void refreshPaymentProjection()
      if (showErrors) setNotice('Sync completed successfully.')
    } catch (err) {
      if (showErrors) setError(err instanceof Error ? err.message : 'Failed to sync Zoho. Showing last saved data.')
    } finally {
      syncingRef.current = false
      setSyncing(false)
    }
  }

  const openOrders = useMemo(() => sanitizeOrders(rows), [rows])
  const orderStage = (order: Order) => stageByOrder[order.id] || (workflowByOrder[order.id]?.status === 'processed' ? 'processed' : 'open')
  const filteredOrders = useMemo(() => openOrders.filter((order) => statusFilter === 'all' || orderStage(order) === statusFilter), [openOrders, statusFilter, stageByOrder, workflowByOrder])
  const pending = (o: Order) => o.lineItems.length ? o.lineItems.reduce((a, i) => a + i.pendingQuantity, 0) : '—'
  const openOrder = async (order: Order) => {
    setError('')
    setLoadingId(order.id)
    try {
      const response = await fetch(`/api/orders/${order.zohoSalesOrderId || order.id}`, { cache: 'no-store' })
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error || 'Could not open order')
      const orderData = json.data.order as Order
      const workflowResponse = await fetch(`/api/workflow/orders/${orderData.id}`, { cache: 'no-store' })
      const workflowJson = await workflowResponse.json()
      const workflow = workflowJson.data?.workflow || null
      setActiveWorkflow(workflow)
      setActiveStage(json.data?.stage || json.data?.status?.lifecycleStage || stageByOrder[order.id] || stageByOrder[orderData.id] || (workflow?.status === 'processed' ? 'processed' : 'open'))
      setActive(applyWorkflow(orderData, workflow))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open order')
    } finally {
      setLoadingId(null)
    }
  }
  return <>
    <section className="card orders-list-card">
      <div className="modal-section-title orders-list-head">
        <div><h2>Confirmed Sales Orders</h2>{lastSyncAt && <p className="muted">Last sync: {new Date(lastSyncAt).toLocaleString()}</p>}</div>
        <div className="orders-list-controls">
          <label className="orders-status-filter" aria-label="Filter orders by status"><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as OrderStage | 'all')}><option value="all">All statuses</option>{ORDER_STAGE_OPTIONS.map((stage) => <option value={stage} key={stage}>{stageLabel(stage)}</option>)}</select></label>
          <button className="btn light sync-icon-btn" aria-label="Sync" title="Sync" onClick={() => syncOrders(true)} disabled={syncing}>{syncing ? '↻' : '⟳'}</button>
        </div>
      </div>
      {syncing && <div className="machine-row compact"><span>Syncing in background</span><Badge>Live</Badge></div>}
      {notice && <div className="form-success">{notice}</div>}
      {error && <div className="form-error">{error}</div>}
      <div className="desktop-table table-wrap"><table className="table"><thead><tr><th>Sales Order</th><th>Customer</th><th>Salesperson</th><th>Delivery</th><th>Status</th><th>Payment</th><th>Action</th></tr></thead><tbody>{filteredOrders.map((o) => <tr key={o.id}><td><strong>{o.salesOrderNumber}</strong></td><td>{o.customerName}</td><td>{o.salesperson || '—'}</td><td>{formatDate(o.deliveryDate)}</td><td><Badge tone={stageTone(orderStage(o))}>{stageLabel(orderStage(o))}</Badge></td><td><PaymentStatusChip status={paymentStatus(o)} />{!paymentStatus(o) && '—'}</td><td><button className="btn light" disabled={loadingId === o.id} onClick={() => openOrder(o)}>{loadingId === o.id ? 'Opening…' : 'View'}</button></td></tr>)}</tbody></table></div>
      <div className="mobile-cards">{filteredOrders.map((o) => <article className="card mobile-order-card mobile-order-tap-card compact-operational-card" key={o.id} onClick={() => openOrder(o)}><div className="compact-card-main"><strong>{o.salesOrderNumber}</strong><p className="muted">{o.customerName}</p><div className="order-status-strip"><Badge tone={stageTone(orderStage(o))}>{stageLabel(orderStage(o))}</Badge><PaymentStatusChip status={paymentStatus(o)} /></div></div><div className="compact-card-side"><div><span>Delivery</span><strong>{formatDate(o.deliveryDate)}</strong></div><div><span>Pending</span><strong>{pending(o)}</strong></div><button className="btn light compact-view-btn" disabled={loadingId === o.id} onClick={(event) => { event.stopPropagation(); openOrder(o) }}>{loadingId === o.id ? 'Opening…' : 'View'}</button></div></article>)}</div>
    </section>
    {active && <OrderModal order={active} stage={activeStage} workflow={activeWorkflow} paymentStatus={paymentStatus(active)} onClose={() => setActive(null)} />}
  </>
}

function OrderModal({ order, stage, workflow, paymentStatus, onClose }: { order: Order; stage: OrderStage; workflow: OrderWorkflow | null; paymentStatus?: ProjectedPaymentStatus; onClose: () => void }) {
  const [selected, setSelected] = useState(() => new Set(order.machines.filter((m) => m.selectedForBatch && !isLockedMachine(m)).map((m) => m.id)))
  const [machines, setMachines] = useState(order.machines)
  const [qrCodes, setQrCodes] = useState<Record<string, string>>(() => initialQrCodes(order, workflow))
  const [generating, setGenerating] = useState(false)
  const [processed, setProcessed] = useState(false)
  const [localStage, setLocalStage] = useState<OrderStage>(stage)
  const [processConfirm, setProcessConfirm] = useState(false)
  const [processSuccess, setProcessSuccess] = useState(false)
  const [dispatchPriority, setDispatchPriority] = useState<'urgent' | 'regular'>('regular')
  const [dispatchNotes, setDispatchNotes] = useState<Record<string, string>>({})
  const [dispatchVendors, setDispatchVendors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const selectableMachines = machines.filter((machine) => !isLockedMachine(machine))
  const nonMachineOnlyOrder = machines.length === 0 && order.lineItems.some((item) => item.dispatchCategory !== 'freight')
  const allSelectableSelected = selectableMachines.length > 0 && selectableMachines.every((machine) => selected.has(machine.id))
  const toggle = (id: string) => setSelected((prev) => {
    if (isLockedMachine(machines.find((machine) => machine.id === id))) return prev
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })
  const toggleSelectAll = () => setSelected(() => allSelectableSelected ? new Set() : new Set(selectableMachines.map((machine) => machine.id)))
  const selectedCount = selected.size
  const modalStage = processed ? 'processed' : localStage
  const canDownloadQr = modalStage !== 'closed'

  useEffect(() => { void preloadLabelAssets() }, [])

  const downloadExistingQr = async (machine: MachineUnit) => {
    if (!machine.serialNumber) return
    setDownloadingId(machine.id)
    setMessage('Preparing local QR PDF…')
    try {
      const date = machine.warrantyStart || new Date().toISOString().slice(0, 10)
      const qrCode = qrCodes[machine.id] || await renderQr(order, machine, date)
      if (!qrCodes[machine.id]) setQrCodes((current) => ({ ...current, [machine.id]: qrCode }))
      await generateBarcodePdf({ order, machines: [machine], qrCodes: { [machine.id]: qrCode } })
      setMessage(`Downloaded QR PDF for serial ${machine.serialNumber}.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not download QR PDF')
    } finally { setDownloadingId(null) }
  }

  const generateSelected = async () => {
    if (!selectedCount) return
    if (!window.confirm(`Generate serial numbers and barcode PDF for ${selectedCount} selected machine${selectedCount === 1 ? '' : 's'}?`)) return
    setGenerating(true)
    setMessage('Generating serials and barcode PDF…')
    try {
      const date = new Date().toISOString().slice(0, 10)
      const allocated = await allocateSerials(order.id, order, machines.filter((machine) => selected.has(machine.id) && !machine.serialNumber).map((machine) => machine.id))
      const selectedMachines = machines.filter((machine) => selected.has(machine.id))
      const generatedEntries = await Promise.all(selectedMachines.map(async (machine) => {
        const serialNumber = machine.serialNumber || allocated[machine.id]
        const qrToken = machine.qrToken || serialNumber
        const qrCode = qrCodes[machine.id] || await renderQr(order, { ...machine, serialNumber, qrToken }, date)
        const nextMachine = { ...machine, serialNumber, qrToken, status: 'QR Generated' as const, warrantyStart: date }
        return { machineId: machine.id, machine: nextMachine, qrCode }
      }))
      const generatedById = new Map(generatedEntries.map((entry) => [entry.machineId, entry]))
      const updated = machines.map((machine) => generatedById.get(machine.id)?.machine || machine)
      const nextQrCodes: Record<string, string> = { ...qrCodes }
      for (const entry of generatedEntries) nextQrCodes[entry.machineId] = entry.qrCode
      const workflowMachines: MachineWorkflow[] = updated.filter((machine) => selected.has(machine.id)).map((machine) => ({ machineUnitId: machine.id, lineItemId: machine.lineItemId, serialNumber: machine.serialNumber, qrToken: machine.qrToken, qrStatus: 'generated', qrGeneratedAt: new Date().toISOString() }))
      // Persist generated eligibility before presenting success or allowing Process Order.
      // A fire-and-forget write left allocated serials at qrStatus=pending when users
      // processed immediately or navigated away (the exact SO-07818 failure mode).
      await saveWorkflow(order.id, { action: 'generate', order: { ...order, machines: updated }, machines: workflowMachines })
      setMachines(updated)
      setQrCodes(nextQrCodes)
      await generateBarcodePdf({ order, machines: updated.filter((machine) => selected.has(machine.id)), qrCodes: nextQrCodes })
      setMessage('Serial and workflow saved; PDF downloaded. Zoho backup queued (non-blocking).')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Serial generation failed. Please retry.')
    } finally {
      setGenerating(false)
    }
  }

  const openPriorityPrompt = () => {
    setMessage('')
    const incomplete = machines.filter((machine) => selected.has(machine.id) && machine.status !== 'Dispatched' && !machine.serialNumber && machine.status !== 'QR Printed')
    if (incomplete.length) { setMessage(`Cannot process. Incomplete: ${incomplete.map((m) => `Unit ${m.unitNumber}`).join(', ')}`); return }
    const initialNotes: Record<string, string> = {}
    const initialVendors: Record<string, string> = {}
    machines.filter((machine) => selected.has(machine.id)).forEach((machine) => {
      initialNotes[machine.id] = machine.dispatchNote || workflow?.machines?.[machine.id]?.dispatchNote || ''
      initialVendors[machine.id] = machine.vendor || workflow?.machines?.[machine.id]?.vendor || ''
    })
    setDispatchNotes(initialNotes)
    setDispatchVendors(initialVendors)
    setDispatchPriority('regular')
    setProcessConfirm(true)
  }

  const processOrder = async () => {
    setMessage('')
    if (!selectedCount) { setMessage('Please select at least one machine.'); return }
    setProcessed(true)
    try {
      const updatedMachines = machines.map((machine) => selected.has(machine.id) ? { ...machine, vendor: titleCaseVendor(dispatchVendors[machine.id] || machine.vendor || '') } : machine)
      const workflow = await saveWorkflow(order.id, { action: 'process', order: { ...order, machines: updatedMachines }, selectedMachineIds: [...selected], dispatchPriority, dispatchNotes, dispatchVendors })
      setMachines(() => updatedMachines.map((machine) => selected.has(machine.id) ? { ...machine, status: 'Processed' as const, dispatchNote: dispatchNotes[machine.id] || '', vendor: titleCaseVendor(dispatchVendors[machine.id] || machine.vendor || '') } : machine))
      setSelected(new Set())
      setProcessSuccess(true)
      window.setTimeout(() => { setProcessSuccess(false); setProcessConfirm(false); setMessage(`Order processed successfully at ${new Date(workflow.data.workflow.processedAt).toLocaleString()}`) }, 1400)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not process order. Please retry.')
    } finally {
      setProcessed(false)
    }
  }

  const proceedWithoutQr = async () => {
    if (!selectedCount && !nonMachineOnlyOrder) { setMessage('Please select at least one machine.'); return }
    const targetLabel = nonMachineOnlyOrder ? 'this non-machine order' : `${selectedCount} selected machine${selectedCount === 1 ? '' : 's'}`
    if (!window.confirm(`Proceed without QR & Serial and move ${targetLabel} to Dispatch View?`)) return
    await saveWorkflow(order.id, { action: 'not_required', order: { ...order, machines }, selectedMachineIds: [...selected] })
    const updated = machines.map((machine) => selected.has(machine.id) ? { ...machine, status: 'QR Printed' as const } : machine)
    await saveWorkflow(order.id, { action: 'process', order: { ...order, machines: updated }, selectedMachineIds: [...selected], dispatchPriority: 'regular' })
    setMachines(updated.map((machine) => selected.has(machine.id) ? { ...machine, status: 'Processed' as const } : machine))
    setSelected(new Set())
    setProcessed(false)
    setMessage(`${nonMachineOnlyOrder ? 'Order' : `Selected machine${selectedCount === 1 ? '' : 's'}`} moved to Regular Dispatch without QR & Serial.`)
  }

  const undoOrder = async () => {
    setMenuOpen(false)
    setMessage('')
    if (!window.confirm(`Undo ${order.salesOrderNumber} and move it back to Open stage? This will let you regenerate serial and QR again.`)) return
    setUndoing(true)
    try {
      await saveWorkflow(order.id, { action: 'undo', order })
      const resetMachines = order.machines.map((machine) => ({ ...machine, serialNumber: '', qrToken: '', status: 'Not Generated' as const }))
      setMachines(resetMachines)
      setQrCodes({})
      setSelected(new Set(resetMachines.map((machine) => machine.id)))
      setProcessed(false)
      setLocalStage('open')
      setMessage('Order moved back to Open stage. You can generate Serial & QR again.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not undo order')
    } finally {
      setUndoing(false)
    }
  }

  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="order-modal card"><div className="modal-head"><div><h1>{order.salesOrderNumber}</h1><div className="order-status-strip"><Badge tone={stageTone(modalStage)}>{stageLabel(modalStage)}</Badge><PaymentStatusChip status={paymentStatus} /></div></div><div className="modal-head-actions"><div className="order-menu-wrap"><button className="drawer-close menu-dot-btn" aria-label="Order actions" onClick={() => setMenuOpen((open) => !open)}>⋯</button>{menuOpen && <div className="order-menu"><button type="button" onClick={undoOrder} disabled={undoing}>{undoing ? 'Undoing…' : 'Undo Order'}</button></div>}</div><button className="drawer-close" onClick={onClose}>×</button></div></div>
    {message && <div className={message.toLowerCase().includes('success') || message.startsWith('Serial saved;') || message.startsWith('Barcode PDF generated') ? 'form-success process-success-tape' : 'form-error'}>{message}</div>}
    <StageTracker stage={modalStage} />
    <div className="grid two details-grid"><Info k="Customer Name" v={order.customerName} /><Info k="Customer Address" v={order.shippingAddress ?? '—'} /><Info k="Salesperson" v={order.salesperson ?? '—'} /><Info k="Expected Delivery Date" v={formatDate(order.deliveryDate)} /></div>
    <section className="modal-section"><h2>Line Items</h2><div className="desktop-table table-wrap line-items-wrap"><table className="table line-items-table"><thead><tr><th>Item</th><th>SKU</th><th>Order Qty</th><th>Pending</th><th>Type</th><th>Wooden</th><th className="line-payment-column" title="Payment status applies to the sales order">Payment</th></tr></thead><tbody>{order.lineItems.map((item) => <tr key={item.id}><td><ItemName name={item.itemName} description={item.description} /></td><td>{item.sku}</td><td>{item.quantity}</td><td>{item.pendingQuantity}</td><td>{dispatchCategoryLabel(item.dispatchCategory)}</td><td>{item.woodenPackingRequired ? 'Yes' : 'No'}</td><td className="line-payment-column" title="Payment status applies to the sales order"><PaymentStatusChip status={paymentStatus} />{!paymentStatus && '—'}</td></tr>)}</tbody></table></div></section>
    <section className="modal-section"><div className="modal-section-title"><h2>Machine Units</h2><div className="machine-select-actions"><button className="btn light" type="button" disabled={!selectableMachines.length} onClick={toggleSelectAll}>{allSelectableSelected ? 'Clear Selection' : 'Select All'}</button><Badge tone="blue">{selectedCount} selected</Badge></div></div>{machines.length ? <div className="unit-grid">{machines.map((m) => <label className={`unit-card ${isLockedMachine(m) ? 'unit-card-disabled' : ''}`} key={m.id}><input type="checkbox" disabled={isLockedMachine(m)} checked={selected.has(m.id)} onChange={() => toggle(m.id)} /><span><strong>Unit {m.unitNumber}</strong><em>{m.itemName}</em>{displayDescription(m.itemName, m.itemDescription) && <small className="item-description">{displayDescription(m.itemName, m.itemDescription)}</small>}<small>{m.serialNumber ? `Serial Number: ${m.serialNumber}` : m.status === 'Dispatched' ? 'Dispatched without serial' : m.status === 'Processed' ? 'Processed without serial' : 'Serial pending'}</small></span>{m.serialNumber && canDownloadQr ? <button type="button" className="btn light unit-action" disabled={downloadingId === m.id} onClick={(event) => { event.preventDefault(); void downloadExistingQr(m) }}>{downloadingId === m.id ? 'Preparing…' : 'Download QR PDF'}</button> : m.status === 'Dispatched' ? <Badge tone="green">Dispatched</Badge> : m.status === 'Processed' ? <Badge tone="amber">Processed</Badge> : <Badge tone="amber">Not Generated</Badge>}</label>)}</div> : <div className="machine-row compact"><span>No machine units for adhesive/consumable-only items.</span><Badge tone="gray">QR Not Required</Badge></div>}</section>
    <section className="modal-actions"><button className="btn light" onClick={proceedWithoutQr}>Proceed Without QR & Serial</button><button className="btn red" disabled={!selectedCount || generating || processed} onClick={generateSelected}>{generating ? 'Generating PDF…' : `Generate Serial & Barcodes for ${selectedCount}`}</button><button className="btn" disabled={processed} onClick={openPriorityPrompt}>{processed ? 'Processed' : 'Process Order'}</button></section>
    {processConfirm && <div className="modal-backdrop nested" role="dialog" aria-modal="true"><section className="card process-confirm-modal"><button className="process-close" aria-label="Close" disabled={processSuccess} onClick={() => setProcessConfirm(false)}>×</button>{processSuccess ? <div className="success-animation"><span>✓</span><h2>Order Processed Successfully</h2></div> : <><h2>Process Order Confirmation</h2><p className="muted">Review the selected machines and add dispatch notes before moving them to Dispatch View.</p><div className="process-type-actions"><button className={`btn ${dispatchPriority === 'urgent' ? 'red' : 'light'}`} onClick={() => setDispatchPriority('urgent')}>Urgent Order</button><button className={`btn ${dispatchPriority === 'regular' ? '' : 'light'}`} onClick={() => setDispatchPriority('regular')}>Regular Order</button></div><div className="confirm-table-wrap"><table className="confirm-table"><thead><tr><th>Machine Name</th><th>Serial Number</th><th>SKU</th><th>Qty</th><th>Wooden Packing</th><th>Vendor</th><th>Notes</th></tr></thead><tbody>{machines.filter((machine) => selected.has(machine.id)).map((machine) => <tr key={machine.id}><td><ItemName name={machine.itemName} description={machine.itemDescription} /></td><td><span className="inline-serials">{machine.serialNumber || 'QR Not Required'}</span></td><td>{machine.sku || '—'}</td><td>1</td><td>{machine.woodenPacking !== 'Not Required' ? 'Yes' : 'No'}</td><td><input className="vendor-input" placeholder="Vendor / Make" value={dispatchVendors[machine.id] || ''} onChange={(event) => setDispatchVendors((prev) => ({ ...prev, [machine.id]: event.target.value }))} /></td><td><textarea className="dispatch-note-input" placeholder="Add dispatch note…" value={dispatchNotes[machine.id] || ''} onChange={(event) => setDispatchNotes((prev) => ({ ...prev, [machine.id]: event.target.value }))} /></td></tr>)}</tbody></table></div><div className="modal-actions"><button className="btn light" disabled={processed} onClick={() => setProcessConfirm(false)}>Cancel</button><button className="btn green" disabled={processed} onClick={processOrder}>{processed ? 'Processing…' : 'Proceed'}</button></div></>}</section></div>}
  </section></div>
}


const ORDER_STAGE_OPTIONS: OrderStage[] = ['open', 'processed', 'packed', 'packing_video', 'loading_video', 'closed']
const STAGE_FLOW: OrderStage[] = ORDER_STAGE_OPTIONS

function StageTracker({ stage }: { stage: OrderStage }) {
  const current = Math.max(0, STAGE_FLOW.indexOf(stage))
  const progressWidth = `calc(${(current / (STAGE_FLOW.length - 1)) * 100}% - ${current === 0 ? '0px' : '0px'})`
  return <section className="stage-tracker" aria-label="Order stage timeline">
    <div className="stage-bar"><span style={{ width: progressWidth }} /></div>
    <div className="stage-steps">{STAGE_FLOW.map((item, index) => <div key={item} className={`stage-step ${index <= current ? 'done' : ''} ${item === stage ? 'active' : ''}`}><i>{index + 1}</i><strong>{stageLabel(item)}</strong></div>)}</div>
  </section>
}

function initialQrCodes(order: Order, workflow: OrderWorkflow | null) {
  const codes: Record<string, string> = {}
  for (const machine of order.machines) {
    const saved = workflow?.machines?.[machine.id]?.qrCode
    if (saved) codes[machine.id] = saved
  }
  return codes
}

async function generateBarcodePdf({ order, machines, qrCodes }: { order: Order; machines: MachineUnit[]; qrCodes: Record<string, string> }) {
  const widthMm = 75
  const heightMm = 50
  const logo = await preloadLabelAssets()
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [widthMm, heightMm], compress: true })
  doc.setProperties({ title: `${order.salesOrderNumber} barcode labels`, subject: 'BSM service warranty QR labels' })

  machines.forEach((machine, index) => {
    if (index > 0) doc.addPage([widthMm, heightMm], 'landscape')
    const qrCode = qrCodes[machine.id]
    const serial = machine.serialNumber || '—'
    const name = machine.itemName || 'Machine'

    doc.setFillColor(255, 255, 255)
    doc.rect(0, 0, widthMm, heightMm, 'F')

    // Reset drawing state on every page. jsPDF keeps draw/fill/text colors
    // between pages; the white footer tick on page 1 was making later label
    // borders and divider lines print white/invisible.
    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(0.35)
    doc.setTextColor(0, 0, 0)
    if (logo) {
      doc.addImage(logo, 'PNG', 4.0, 4.6, 25.0, 7.2)
    } else {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(19)
      doc.text('BSM', 3.8, 10.5)
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.6)
    doc.text('SERVICE WARRANTY', 52.6, 6.7, { align: 'center' })
    doc.setFontSize(3.9)
    doc.text('BUILD SCALE MANUFACTURE PVT. LTD.', 52.6, 10.1, { align: 'center' })
    doc.setLineWidth(0.55)
    doc.line(32.2, 12.4, 71.5, 12.4)

    doc.setLineWidth(0.35)
    doc.roundedRect(2.5, 14.0, 27.0, 28.8, 1.2, 1.2)
    if (qrCode) doc.addImage(qrCode, 'PNG', 5.1, 16.0, 21.8, 21.8)
    doc.setFontSize(4.3)
    doc.text('S C A N   F O R   D E T A I L S', 5.0, 40.6)

    doc.line(31.0, 14.0, 31.0, 42.8)
    doc.roundedRect(33.0, 14.2, 38.5, 6.8, 1.1, 1.1)
    doc.setFillColor(0, 0, 0)
    doc.roundedRect(34.3, 15.6, 15.0, 4.0, 0.8, 0.8, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(3.9)
    doc.text('S E R I A L  N O.', 35.1, 18.2)
    doc.setTextColor(0, 0, 0)
    doc.setFontSize(9.0)
    doc.text(serial, 52.0, 19.1)

    doc.setLineWidth(0.4)
    doc.line(33.0, 23.0, 71.2, 23.0)
    doc.setFontSize(4.0)
    doc.text('M O D E L', 33.0, 26.3)
    doc.setFontSize(name.length > 32 ? 6.1 : 7.0)
    const lines = doc.splitTextToSize(name, 37).slice(0, 2)
    doc.text(lines, 33.0, 30.1)
    doc.line(33.0, 36.0, 71.2, 36.0)

    doc.roundedRect(33.0, 37.6, 38.5, 5.2, 0.9, 0.9)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(4.7)
    doc.text('HELPLINE', 37.6, 41.1, { align: 'center' })
    doc.setLineWidth(0.35)
    doc.line(43.2, 38.5, 43.2, 42.0)
    doc.setFontSize(7.2)
    doc.text('9310823242', 57.3, 41.25, { align: 'center' })

    doc.setFillColor(0, 0, 0)
    doc.rect(0.9, 44.2, 73.2, 4.9, 'F')
    doc.setDrawColor(255, 255, 255)
    doc.setLineWidth(0.75)
    doc.line(4.0, 46.8, 5.2, 47.8)
    doc.line(5.2, 47.8, 7.4, 45.7)
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(3.9)
    doc.text('KEEP THIS LABEL INTACT FOR SERVICE & WARRANTY', 12.0, 47.4)
  })

  doc.save(`${safeFileName(order.salesOrderNumber)}-barcodes.pdf`)
}

let labelLogoPromise: Promise<string> | null = null
function preloadLabelAssets() { return labelLogoPromise ||= imageToDataUrl('/bsm-label-logo.png') }
function renderQr(order: Order, machine: MachineUnit, date: string) {
  return QRCode.toDataURL(buildQrPayload({ order, machine, date }), { margin: 1, width: 240 })
}

async function imageToDataUrl(src: string) {
  try {
    const response = await fetch(src)
    if (!response.ok) return ''
    const blob = await response.blob()
    return await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(String(reader.result || ''))
      reader.onerror = () => resolve('')
      reader.readAsDataURL(blob)
    })
  } catch { return '' }
}

function Info({ k, v }: { k: string; v: string }) { return <div className="info-tile"><span>{k}</span><strong>{v}</strong></div> }
function ItemName({ name, description }: { name: string; description?: string }) { const cleanDescription = displayDescription(name, description); return <div className="item-name-stack"><strong>{name}</strong>{cleanDescription && <small className="item-description">{cleanDescription}</small>}</div> }
function sanitizeOrders(orders: Order[]) { return orders }
function statusLabel(status: string) { return ({ open: 'Open', partially_shipped: 'Partially Shipped', partially_generated: 'Partially Generated', qr_generated: 'QR Generated', qr_not_required: 'QR Not Required', processed: 'Processed' } as Record<string, string>)[status] || status }
function stageLabel(stage: string) { return ({ open: 'Open', processed: 'Processed', packed: 'Packed', packing_video: 'Packing Video', loading_video: 'Loading Video', closed: 'Closed' } as Record<string, string>)[stage] || stage }
function stageTone(stage: string): 'red' | 'green' | 'amber' | 'blue' | 'gray' | 'purple' {
  return ({
    open: 'gray',
    processed: 'amber',
    packed: 'blue',
    packing_video: 'purple',
    loading_video: 'purple',
    closed: 'red',
  } as Record<string, 'red' | 'green' | 'amber' | 'blue' | 'gray' | 'purple'>)[stage] || 'gray'
}
function formatDate(value: string) { const d = new Date(value); if (Number.isNaN(d.getTime())) return value; return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getFullYear()).slice(-2)}` }
function titleCaseVendor(value: string) { return value.trim().toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase()) }
function isLockedMachine(machine?: MachineUnit) { return machine?.status === 'Processed' || machine?.status === 'Dispatched' }
function displayDescription(name: string, description?: string) {
  const clean = String(description || '').replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  if (clean.toLowerCase() === String(name || '').replace(/\s+/g, ' ').trim().toLowerCase()) return ''
  return clean
}
function applyWorkflow(order: Order, workflow: OrderWorkflow | null) { if (!workflow) return order; return { ...order, machines: order.machines.map((machine) => { const saved = workflow.machines[machine.id]; if (!saved) return machine; return { ...machine, serialNumber: saved.serialNumber || '', qrToken: saved.qrToken || '', status: saved.dispatchedAt ? 'Dispatched' : saved.processedAt ? 'Processed' : saved.qrStatus === 'generated' ? 'QR Generated' : saved.qrStatus === 'not_required' ? 'QR Printed' : machine.status } }) } }
async function saveWorkflow(orderId: string, payload: unknown) { const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 30_000); try { const response = await fetch(`/api/workflow/orders/${orderId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal }); const json = await response.json().catch(() => ({})); if (!response.ok || !json.ok) throw new Error(json.error || `Could not save workflow (${response.status})`); return json } catch (error) { if (error instanceof DOMException && error.name === 'AbortError') throw new Error('Processing timed out. No duplicate will be created; please retry once.'); throw error } finally { window.clearTimeout(timeout) } }
async function allocateSerials(orderId: string, order: Order, machineIds: string[]) { if (!machineIds.length) return {} as Record<string, string>; const response = await fetch(`/api/workflow/orders/${orderId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'allocate_serials', order, machineIds }) }); const json = await response.json(); if (!response.ok || !json.ok) throw new Error(json.error || 'Could not allocate serial numbers'); return (json.data?.serials || {}) as Record<string, string> }
function readCachedOrders() { if (typeof window === 'undefined') return []; try { return sanitizeOrders(JSON.parse(localStorage.getItem(ORDERS_CACHE_KEY) || '[]') as Order[]) } catch { return [] } }
function cacheOrders(orders: Order[]) { safeLocalStorageSet(ORDERS_CACHE_KEY, JSON.stringify(sanitizeOrders(orders))) }
function safeFileName(value: string) { return value.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim() || 'Machine' }
function readProcessedOrders(): Order[] { try { return JSON.parse(localStorage.getItem(PROCESSED_ORDERS_KEY) || '[]') as Order[] } catch { return [] } }
function downloadDataUrl(fileName: string, dataUrl: string) { const a = document.createElement('a'); a.href = dataUrl; a.download = fileName; document.body.appendChild(a); a.click(); a.remove() }
function buildQrPayload({ order, machine, date }: { order: Order; machine: MachineUnit; date: string }) { return [`Sales Order Number: ${order.salesOrderNumber}`, `Customer Name: ${order.customerName}`, `Customer Address: ${order.shippingAddress || '—'}`, `Machine Name: ${machine.itemName}`, `Machine Serial Number: ${machine.serialNumber}`, `Date: ${date}`].join('\n') }
