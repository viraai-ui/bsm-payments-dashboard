'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/DashboardShell'
import { dispatchCategoryLabel, isMachineLineItem } from '@/lib/item-classification'
import type { AppRole } from '@/lib/auth'
import type { MachineUnit, Order, OrderLineItem } from '@/types/domain'

const PACKING_STATE_KEY = 'bsm.packing.state.v1'

type PackingState = Record<string, { urgent?: boolean }>
type MachineGroup = { itemName: string; description?: string; sku?: string; serials: string[]; notes: string[]; quantity: number; woodenPackingRequired: boolean; category?: string }
type DispatchOrder = Order & { dispatchPriority?: 'urgent' | 'regular'; dispatchSortOrder?: number }

export function PackagingTvClient({ userRole }: { userRole: AppRole }) {
  const [orders, setOrders] = useState<DispatchOrder[]>([])
  const [state, setState] = useState<PackingState>({})
  const [syncing, setSyncing] = useState(false)
  const syncingRef = useRef(false)
  const boardRef = useRef<HTMLElement | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [draggingOrderId, setDraggingOrderId] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const canMoveOrders = userRole === 'Admin' || userRole === 'Operations'

  useEffect(() => {
    setState(readState())
    void syncLocal(true)
    const timer = window.setInterval(() => { void syncLocal(true) }, 15 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const sorted = useMemo(() => [...orders].sort(compareDispatchOrders), [orders])
  const urgent = sorted.filter((order) => isUrgent(order, state))
  const regular = sorted.filter((order) => !isUrgent(order, state))

  async function syncLocal(silent = false) {
    if (syncingRef.current) return
    syncingRef.current = true
    setSyncing(true); setError(''); if (!silent) setNotice('')
    try {
      const response = await fetch('/api/packaging-tv', { cache: 'no-store' })
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error || 'Could not sync Packaging TV')
      setOrders(json.data?.orders || [])
      setLastSyncedAt(new Date().toISOString())
      if (!silent) setNotice('Sync completed successfully.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sync Packaging TV')
    } finally { syncingRef.current = false; setSyncing(false) }
  }

  async function completeOrder(order: Order) {
    if (!window.confirm(`Mark ${order.salesOrderNumber} as Packaging Completed?`)) return
    const response = await fetch('/api/packaging-tv', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order, machineIds: order.machines.map((machine) => machine.id) }) })
    const json = await response.json()
    if (!response.ok || !json.ok) { setError(json.error || 'Could not complete packaging'); return }
    setOrders((prev) => prev.filter((item) => item.id !== order.id))
  }

  async function persistColumnOrder(priority: 'urgent' | 'regular', orderedIds: string[]) {
    const response = await fetch('/api/packaging-tv', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'reorder', priority, orderedIds }) })
    const json = await response.json()
    if (!response.ok || !json.ok) throw new Error(json.error || 'Could not save dispatch order')
  }

  async function moveOrderPriority(orderId: string, priority: 'urgent' | 'regular') {
    if (!canMoveOrders) { setError('Only Admin and Operations can move orders between dispatch columns.'); return }
    const target = priority
    const existing = orders.find((order) => order.id === orderId)
    if (!existing) return
    const before = orders
    const targetColumn = before.filter((order) => order.id !== orderId && isUrgent(order, state) === (target === 'urgent')).sort(compareDispatchOrders)
    const reorderedColumn = [{ ...existing, dispatchPriority: target }, ...targetColumn].map((order, index) => ({ ...order, dispatchPriority: target, dispatchSortOrder: index + 1 }))
    setError(''); setNotice('')
    setOrders((prev) => prev.map((order) => reorderedColumn.find((item) => item.id === order.id) || order))
    try {
      const response = await fetch('/api/packaging-tv', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'priority', orderId, priority: target, orderedIds: reorderedColumn.map((order) => order.id) }) })
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error || 'Could not update dispatch priority')
      setNotice(`${existing.salesOrderNumber} moved to ${target === 'urgent' ? 'Urgent' : 'Regular'} Dispatch.`)
    } catch (err) {
      setOrders(before)
      setError(err instanceof Error ? err.message : 'Could not update dispatch priority')
    }
  }

  function handleDrop(event: React.DragEvent, priority: 'urgent' | 'regular') {
    if (!canMoveOrders) return
    event.preventDefault()
    event.stopPropagation()
    const orderId = event.dataTransfer.getData('text/plain') || draggingOrderId
    setDraggingOrderId(null)
    if (orderId) void moveOrderPriority(orderId, priority)
  }

  function handleCardDrop(event: React.DragEvent, targetOrderId: string, priority: 'urgent' | 'regular') {
    if (!canMoveOrders) return
    event.preventDefault()
    event.stopPropagation()
    const movingId = event.dataTransfer.getData('text/plain') || draggingOrderId
    setDraggingOrderId(null)
    if (!movingId || movingId === targetOrderId) return
    const before = orders
    const moving = before.find((order) => order.id === movingId)
    if (!moving) return
    const targetColumn = before.filter((order) => (order.id === movingId ? priority === 'urgent' : isUrgent(order, state) === (priority === 'urgent')) && order.id !== movingId).sort(compareDispatchOrders)
    const targetIndex = Math.max(0, targetColumn.findIndex((order) => order.id === targetOrderId))
    const reorderedColumn = [...targetColumn.slice(0, targetIndex), { ...moving, dispatchPriority: priority }, ...targetColumn.slice(targetIndex)].map((order, index) => ({ ...order, dispatchPriority: priority, dispatchSortOrder: index + 1 }))
    setOrders((prev) => prev.map((order) => reorderedColumn.find((item) => item.id === order.id) || (order.id === movingId ? { ...order, dispatchPriority: priority, dispatchSortOrder: targetIndex + 1 } : order)))
    persistColumnOrder(priority, reorderedColumn.map((order) => order.id)).then(() => setNotice(`${moving.salesOrderNumber} moved and reordered.`)).catch((err) => { setOrders(before); setError(err instanceof Error ? err.message : 'Could not save dispatch order') })
  }

  function handleDragOver(event: React.DragEvent) {
    if (!canMoveOrders) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  async function toggleFullscreen() {
    const target = boardRef.current
    if (!target) return
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await target.requestFullscreen()
    } catch { setError('Fullscreen is not available in this browser.') }
  }

  function goBack() {
    if (window.history.length > 1) {
      window.history.back()
      return
    }
    window.location.assign('/')
  }

  return <main className="packaging-tv-light" ref={boardRef}>
    <header className="top compact-top packaging-tv-head"><div className="dispatch-heading">{canMoveOrders && <button type="button" className="dispatch-back-button" onClick={goBack} aria-label="Go back" title="Back">← <span>Back</span></button>}<div><h1 className="h1">Dispatch View</h1><p className="muted dispatch-auto-sync">Auto-sync every 15 min{lastSyncedAt ? ` • Last ${formatTime(lastSyncedAt)}` : ''}</p></div></div><div className="tabs packaging-sync-actions"><Badge tone="green">{orders.length} Active {orders.length === 1 ? 'Order' : 'Orders'}</Badge><button className="btn light sync-icon-btn" aria-label="Sync" title="Sync" onClick={() => syncLocal()} disabled={syncing}>{syncing ? '↻' : '⟳'}</button><button className="btn light sync-icon-btn fullscreen-btn" aria-label="Fullscreen" title="Fullscreen" onClick={toggleFullscreen}>{fullscreen ? '⤢' : '⛶'}</button></div></header>
    {notice && <div className="form-success">{notice}</div>}
    {error && <div className="form-error">{error}</div>}
    {canMoveOrders && draggingOrderId && <>
      <button type="button" className="dispatch-edge-drop urgent" onDragOver={handleDragOver} onDrop={(event) => handleDrop(event, 'urgent')} onClick={() => { if (draggingOrderId) void moveOrderPriority(draggingOrderId, 'urgent'); setDraggingOrderId(null) }}>
        <span>Drop to</span>
        <strong>Urgent Dispatch</strong>
      </button>
      <button type="button" className="dispatch-edge-drop regular" onDragOver={handleDragOver} onDrop={(event) => handleDrop(event, 'regular')} onClick={() => { if (draggingOrderId) void moveOrderPriority(draggingOrderId, 'regular'); setDraggingOrderId(null) }}>
        <span>Drop to</span>
        <strong>Regular Dispatch</strong>
      </button>
    </>}
    <div className="packaging-dispatch-grid">
      <DispatchSection title="Urgent Dispatch" tone="urgent" orders={urgent} state={state} completeOrder={completeOrder} draggingOrderId={draggingOrderId} onDragStart={setDraggingOrderId} onDrop={handleDrop} onCardDrop={handleCardDrop} canMoveOrders={canMoveOrders} />
      <DispatchSection title="Regular Dispatch" tone="regular" orders={regular} state={state} completeOrder={completeOrder} draggingOrderId={draggingOrderId} onDragStart={setDraggingOrderId} onDrop={handleDrop} onCardDrop={handleCardDrop} canMoveOrders={canMoveOrders} />
    </div>
  </main>
}

function DispatchSection({ title, tone, orders, state, completeOrder, draggingOrderId, onDragStart, onDrop, onCardDrop, canMoveOrders }: { title: string; tone: 'urgent' | 'regular'; orders: DispatchOrder[]; state: PackingState; completeOrder: (order: DispatchOrder) => void; draggingOrderId: string | null; onDragStart: (orderId: string | null) => void; onDrop: (event: React.DragEvent, priority: 'urgent' | 'regular') => void; onCardDrop: (event: React.DragEvent, targetOrderId: string, priority: 'urgent' | 'regular') => void; canMoveOrders: boolean }) {
  return <section className={`packaging-section ${tone} ${canMoveOrders && draggingOrderId ? 'drag-ready' : ''}`} onDragOver={(event) => { if (canMoveOrders) event.preventDefault() }} onDrop={(event) => onDrop(event, tone)}><div className="packaging-section-head"><h2>{title}</h2><span>{orders.length}</span></div><div className="packaging-order-list">{orders.length ? orders.map((order) => <OrderCard key={order.id} order={order} urgent={isUrgent(order, state)} completeOrder={completeOrder} onDragStart={onDragStart} onCardDrop={onCardDrop} canMoveOrders={canMoveOrders} />) : <div className="card packaging-empty">{canMoveOrders ? 'Drop orders here' : 'No orders here'}</div>}</div></section>
}

function OrderCard({ order, urgent, completeOrder, onDragStart, onCardDrop, canMoveOrders }: { order: DispatchOrder; urgent: boolean; completeOrder: (order: DispatchOrder) => void; onDragStart: (orderId: string | null) => void; onCardDrop: (event: React.DragEvent, targetOrderId: string, priority: 'urgent' | 'regular') => void; canMoveOrders: boolean }) {
  const groups = [...groupMachines(order.machines), ...groupDispatchLineItems(order.lineItems)]
  return <article className={`card packaging-order-card ${canMoveOrders ? 'can-drag' : 'no-drag'}`} draggable={canMoveOrders} onDragOver={(event) => { if (canMoveOrders) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }} onDrop={(event) => onCardDrop(event, order.id, urgent ? 'urgent' : 'regular')} onDragStart={(event) => { if (!canMoveOrders) return; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', order.id); onDragStart(order.id) }} onDragEnd={() => onDragStart(null)}><div className="dispatch-reorder-cue">Drop above this order</div><div className="packaging-order-title"><div><h3>{order.salesOrderNumber}</h3><p>Expected Delivery: {formatDate(order.deliveryDate)}</p></div><div className="dispatch-card-meta">{order.salesperson && order.salesperson !== '—' && <span className="dispatch-salesperson">{order.salesperson}</span>}{urgent && <Badge tone="amber">Urgent</Badge>}</div></div><div className="packaging-machine-table"><div className="packaging-row packaging-header"><span>Machine</span><span>SKU</span><span>Qty</span><span>Wooden Packing</span><span>Notes</span></div>{groups.map((group) => <div className="packaging-row" key={`${group.category || 'machine'}-${group.itemName}-${group.sku || ''}-${group.serials.join('-')}`}><ItemName name={group.itemName} description={group.description} serials={group.serials} /><span className="dispatch-sku">{group.sku || '—'}</span><b>{formatQty(group.quantity, group.category)}</b><b className={group.woodenPackingRequired ? 'wooden-yes' : 'wooden-no'}>{group.woodenPackingRequired ? 'Yes' : 'No'}</b><span className="dispatch-notes">{group.notes.length ? group.notes.join(' • ') : '—'}</span></div>)}</div><button className="btn green full packaging-complete" onClick={() => completeOrder(order)}>Complete</button></article>
}

function groupMachines(machines: MachineUnit[]) {
  const map = new Map<string, MachineGroup>()
  for (const machine of machines) {
    const key = `${machine.itemName}::${machine.itemDescription || ''}`
    const current = map.get(key) || { itemName: machine.itemName, description: machine.itemDescription, sku: machine.sku, serials: [], notes: [], quantity: 0, woodenPackingRequired: false, category: 'Machine' }
    current.serials.push(machine.serialNumber || '')
    if (machine.dispatchNote?.trim()) current.notes.push(machine.dispatchNote.trim())
    current.quantity += 1
    current.woodenPackingRequired ||= machine.woodenPacking !== 'Not Required'
    map.set(key, current)
  }
  return [...map.values()]
}

function groupDispatchLineItems(lineItems: OrderLineItem[]) {
  return lineItems.filter((item) => !isMachineLineItem(item) && item.dispatchCategory !== 'freight').map((item) => ({
    itemName: item.itemName,
    description: item.description,
    sku: item.sku,
    serials: [],
    notes: [],
    quantity: item.quantity,
    woodenPackingRequired: false,
    category: dispatchCategoryLabel(item.dispatchCategory),
  }))
}
function formatQty(quantity: number, category?: string) { return category === 'Adhesive' ? `${quantity} kgs` : quantity }
function ItemName({ name, description, serials = [] }: { name: string; description?: string; serials?: string[] }) { const cleanDescription = displayDescription(name, description); return <div className="item-name-stack dispatch-item-name"><strong>{name}</strong>{serials.length > 0 && <span className="inline-serials">Serial: {serials.filter(Boolean).join(', ') || 'QR Not Required'}</span>}{cleanDescription && <small className="item-description">{cleanDescription}</small>}</div> }
function displayDescription(name: string, description?: string) {
  const clean = String(description || '').replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  if (clean.toLowerCase() === String(name || '').replace(/\s+/g, ' ').trim().toLowerCase()) return ''
  return clean
}
function isUrgent(order: DispatchOrder, state: PackingState) { if (order.dispatchPriority) return order.dispatchPriority === 'urgent'; return order.machines.some((machine) => state[machine.id]?.urgent) }
function compareDispatchOrders(a: DispatchOrder, b: DispatchOrder) {
  const deliveryDiff = dayValue(a.deliveryDate) - dayValue(b.deliveryDate)
  if (deliveryDiff !== 0) return deliveryDiff
  const aManual = Number.isFinite(a.dispatchSortOrder) ? Number(a.dispatchSortOrder) : null
  const bManual = Number.isFinite(b.dispatchSortOrder) ? Number(b.dispatchSortOrder) : null
  if (aManual !== null || bManual !== null) return (aManual ?? 999999) - (bManual ?? 999999)
  return dateValue(a.deliveryDate) - dateValue(b.deliveryDate)
}
function readState(): PackingState { try { return JSON.parse(localStorage.getItem(PACKING_STATE_KEY) || '{}') as PackingState } catch { return {} } }
function dateValue(value: string) { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : 9999999999999 }
function dayValue(value: string) { const parsed = dateValue(value); if (parsed >= 9999999999999) return parsed; const d = new Date(parsed); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) }
function formatDate(value: string) { const d = new Date(value); if (Number.isNaN(d.getTime())) return value; return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getFullYear()).slice(-2)}` }
function formatTime(value: string) { const d = new Date(value); if (Number.isNaN(d.getTime())) return ''; return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
