'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PAYMENT_ADDED_BY_USERS, sortPayments, type Payment, type PaymentAddedBy, type PaymentMode, type PaymentStatus } from '@/lib/payments'
import type { PaymentNotification } from '@/lib/payment-notifications'
import type { AppRole } from '@/lib/auth'
import { PaymentProofViewer, type ViewerProof } from './PaymentProofViewer'
import { normalizePaymentScreenshotFile } from '@/lib/payment-screenshot'

type OrderSuggestion = { id: string; salesOrderNumber: string; customerName: string; status: 'Open' | 'Closed' | 'Status unknown'; rawStatus: string }

const PAYMENT_MODES: PaymentMode[] = ['Bank Transfer', 'UPI', 'Cash', 'Credit Card', 'Debit Card', 'Other']
const formatAmount = (amount?: number) => amount == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount)
const formatPaymentDate = (date: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(date))

export function PaymentsClient({ initialPayments, userRole }: { initialPayments: Payment[]; userRole: AppRole }) {
  const [payments, setPayments] = useState(() => sortPayments(initialPayments))
  const [open, setOpen] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [salesOrderNumber, setSalesOrderNumber] = useState('')
  const [selectedOrderNumber, setSelectedOrderNumber] = useState('')
  const [selectedOrder, setSelectedOrder] = useState<OrderSuggestion | null>(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Bank Transfer')
  const [addedBy, setAddedBy] = useState<PaymentAddedBy | ''>('')
  const [files, setFiles] = useState<File[]>([])
  const [remarks, setRemarks] = useState('')
  const [viewer, setViewer] = useState<ViewerProof[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [orders, setOrders] = useState<OrderSuggestion[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [ordersLoaded, setOrdersLoaded] = useState(false)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [orderInteracted, setOrderInteracted] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [updatingPaymentId, setUpdatingPaymentId] = useState('')
  const [pushState, setPushState] = useState<'checking' | 'unsupported' | 'prompt' | 'enabled' | 'denied' | 'error'>('checking')
  const [pushBusy, setPushBusy] = useState(false)
  const [notifications, setNotifications] = useState<PaymentNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const pollingRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollFailuresRef = useRef(0)
  const orderRequestRef = useRef<AbortController | null>(null)
  const orderGenerationRef = useRef(0)
  const orderCacheRef = useRef(new Map<string, OrderSuggestion[]>())
  const isAdmin = userRole === 'Admin'
  const isAccounts = userRole === 'Accounts'

  const refreshPayments = useCallback(async () => {
    if (pollingRef.current) return
    pollingRef.current = true
    try {
      const response = await fetch('/api/payments', { cache: 'no-store' })
      const json = await response.json().catch(() => ({}))
      if (!response.ok || !json.ok) throw new Error(json.error || 'Could not refresh payments')
      setPayments(sortPayments(Array.isArray(json.data?.payments) ? json.data.payments : []))
      pollFailuresRef.current = 0
    } catch {
      pollFailuresRef.current += 1
      if (pollFailuresRef.current >= 3) setError('Live payment updates are temporarily unavailable. Retrying automatically.')
    } finally { pollingRef.current = false }
  }, [])

  const refreshNotifications = useCallback(async () => {
    try {
      const response = await fetch('/api/payments/notifications', { cache: 'no-store' })
      const json = await response.json().catch(() => ({}))
      if (!response.ok || !json.ok) return
      setNotifications(Array.isArray(json.data?.notifications) ? json.data.notifications : [])
      setUnreadCount(Number(json.data?.unreadCount) || 0)
    } catch { /* polling will retry */ }
  }, [])

  useEffect(() => {
    void refreshPayments(); void refreshNotifications()
    let timer: ReturnType<typeof setInterval> | undefined
    const schedule = () => { if (timer) clearInterval(timer); timer = setInterval(() => { if (document.visibilityState === 'visible') { void refreshPayments(); void refreshNotifications() } }, document.visibilityState === 'visible' ? 5000 : 30000) }
    const onVisible = () => { schedule(); if (document.visibilityState === 'visible') { void refreshPayments(); void refreshNotifications() } }
    const onFocus = () => { void refreshPayments(); void refreshNotifications() }
    schedule(); document.addEventListener('visibilitychange', onVisible); window.addEventListener('focus', onFocus)
    return () => { if (timer) clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onFocus) }
  }, [refreshNotifications, refreshPayments])

  async function markNotificationRead(id?: string) {
    const response = await fetch('/api/payments/notifications', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(id ? { id } : { all: true }) })
    const json = await response.json().catch(() => ({}))
    if (response.ok && json.ok) { setNotifications(json.data.notifications || []); setUnreadCount(json.data.unreadCount || 0) }
  }

  async function openNotification(notification: PaymentNotification) {
    if (!notification.readAt) await markNotificationRead(notification.id)
    setNotificationsOpen(false)
    await refreshPayments()
    requestAnimationFrame(() => { const element = document.querySelector(`[data-payment-id="${CSS.escape(notification.paymentId)}"]`); element?.scrollIntoView({ behavior: 'smooth', block: 'center' }); element?.classList.add('payment-highlight'); setTimeout(() => element?.classList.remove('payment-highlight'), 2200) })
  }

  useEffect(() => {
    if (!isAdmin && !isAccounts) return
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { setPushState('unsupported'); return }
    navigator.serviceWorker.register('/payment-push-sw.js').then((registration) => registration.pushManager.getSubscription()).then((subscription) => {
      if (subscription) setPushState('enabled')
      else if (Notification.permission === 'denied') setPushState('denied')
      else setPushState(localStorage.getItem('payment-push-consent-dismissed') ? 'checking' : 'prompt')
    }).catch(() => setPushState('error'))
  }, [isAdmin, isAccounts])

  async function enablePush() {
    setPushBusy(true); setError('')
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('Notifications are not supported in this browser. On iPhone/iPad, install this site to your Home Screen first.')
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setPushState(permission === 'denied' ? 'denied' : 'prompt'); localStorage.setItem('payment-push-consent-dismissed', '1'); return }
      const configResponse = await fetch('/api/payments/push-subscription', { cache: 'no-store' })
      const config = await configResponse.json().catch(() => ({}))
      if (!configResponse.ok || !config.ok) throw new Error(config.error || 'Notifications are not configured')
      const registration = await navigator.serviceWorker.ready
      const key = config.data.publicKey.replace(/-/g, '+').replace(/_/g, '/')
      const padding = '='.repeat((4 - key.length % 4) % 4)
      const applicationServerKey = Uint8Array.from(atob(key + padding), (character) => character.charCodeAt(0))
      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
      const response = await fetch('/api/payments/push-subscription', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: subscription.toJSON() }) })
      const json = await response.json().catch(() => ({}))
      if (!response.ok || !json.ok) throw new Error(json.error || 'Could not enable notifications')
      localStorage.removeItem('payment-push-consent-dismissed'); setPushState('enabled')
    } catch (reason) { setPushState('error'); setError(reason instanceof Error ? reason.message : 'Could not enable notifications') }
    finally { setPushBusy(false) }
  }

  useEffect(() => {
    if (!open || selectedOrder || !orderInteracted) return
    const search = salesOrderNumber.trim()
    const cached = orderCacheRef.current.get(search)
    if (cached) { setOrders(cached); setOrdersLoaded(true); return }
    const timer = window.setTimeout(() => {
    orderRequestRef.current?.abort(); const controller = new AbortController(); orderRequestRef.current = controller; const generation = ++orderGenerationRef.current
    setOrdersLoading(true)
    const timeout = window.setTimeout(() => controller.abort(), 8_000)
    fetch(`/api/payments/open-sales-orders?limit=${search ? 25 : 10}${search ? `&q=${encodeURIComponent(search)}` : ''}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const json = await response.json().catch(() => ({}))
        if (!response.ok || !json.ok) throw new Error(json.error || 'Could not load sales orders')
        if (generation !== orderGenerationRef.current) return
        const next = Array.isArray(json.data?.orders) ? json.data.orders : []; orderCacheRef.current.set(search, next); setOrders(next)
      })
      .catch((reason) => { if (generation === orderGenerationRef.current && reason?.name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'Could not load sales orders') })
      .finally(() => { clearTimeout(timeout); if (generation === orderGenerationRef.current) { setOrdersLoading(false); setOrdersLoaded(true) } })
    }, search ? 225 : 0)
    return () => { clearTimeout(timer); orderRequestRef.current?.abort() }
  }, [open, salesOrderNumber, selectedOrder, orderInteracted])

  const matchingOrders = useMemo(() => orders, [orders])

  function selectOrder(order: OrderSuggestion) {
    setSalesOrderNumber(order.salesOrderNumber)
    setSelectedOrderNumber(order.salesOrderNumber)
    setSelectedOrder(order)
    setCustomerName(order.customerName)
    setSuggestionsOpen(false)
  }

  function clearOrder() { setSalesOrderNumber(''); setSelectedOrderNumber(''); setSelectedOrder(null); setCustomerName(''); setSuggestionsOpen(false) }
  function interactWithOrder() { setOrderInteracted(true); setSuggestionsOpen(true) }

  function handleOrderKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && matchingOrders.length) { event.preventDefault(); setSuggestionsOpen(true); setActiveSuggestion((index) => Math.min(index + 1, matchingOrders.length - 1)) }
    else if (event.key === 'ArrowUp' && matchingOrders.length) { event.preventDefault(); setActiveSuggestion((index) => Math.max(index - 1, 0)) }
    else if (event.key === 'Enter' && suggestionsOpen && matchingOrders[activeSuggestion]) { event.preventDefault(); selectOrder(matchingOrders[activeSuggestion]) }
    else if (event.key === 'Escape') setSuggestionsOpen(false)
  }

  function resetPaymentForm() {
    orderRequestRef.current?.abort(); orderGenerationRef.current += 1
    setCustomerName(''); setSalesOrderNumber(''); setSelectedOrderNumber(''); setSelectedOrder(null); setPaymentAmount(''); setPaymentMode('Bank Transfer'); setAddedBy(''); setFiles([]); setRemarks('')
    setOrders([]); setOrdersLoaded(false); setOrdersLoading(false); setSuggestionsOpen(false); setOrderInteracted(false); setActiveSuggestion(0); setError(''); setSyncMessage('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }
  function openPaymentForm() { resetPaymentForm(); setOpen(true) }
  function closePaymentForm() { if (!busy) { resetPaymentForm(); setOpen(false) } }

  async function syncOpenOrders() {
    setSyncing(true); setError(''); setSyncMessage('')
    try {
      const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 60_000)
      const response = await fetch('/api/payments/open-sales-orders?refresh=1&limit=10', { cache: 'no-store', signal: controller.signal }).finally(() => clearTimeout(timeout))
      const json = await response.json().catch(() => ({}))
      if (!response.ok || !json.ok) throw new Error(json.error || 'Could not sync Zoho sales orders')
      const latest = Array.isArray(json.data?.orders) ? json.data.orders : []
      setOrders(latest); setOrdersLoaded(true); setSelectedOrderNumber(''); setSelectedOrder(null); setSalesOrderNumber(''); setCustomerName('')
      orderCacheRef.current.clear(); orderCacheRef.current.set('', latest); setSyncMessage('Sales-order search index refreshed.')
      setSuggestionsOpen(open)
    } catch (reason) {
      setOrders([]); setOrdersLoaded(true)
      setError(reason instanceof Error ? reason.message : 'Could not sync Zoho sales orders')
    } finally { setSyncing(false) }
  }

  async function addPayment(event: React.FormEvent) {
    event.preventDefault()
    const amount = Number(paymentAmount)
    const linked = Boolean(selectedOrder && selectedOrderNumber && selectedOrderNumber === salesOrderNumber)
    const manualCustomer = customerName.trim()
    if (!manualCustomer || manualCustomer.length > 120 || /[\u0000-\u001f\u007f-\u009f<>]/u.test(manualCustomer)) { setError('Enter a valid customer name (maximum 120 characters).'); return }
    if (!Number.isFinite(amount) || amount <= 0) { setError('Enter a valid payment amount greater than zero.'); return }
    if (!addedBy) { setError('Select who added the payment.'); return }
    if (files.length < 1 || files.length > 10) { setError('Attach between 1 and 10 payment proofs.'); return }
    setBusy(true); setError('')
    try {
      const attachments: { key: string; name: string }[] = []
      let uploadScope = ''
      const uploadOne = async (file: File) => { const targetResponse = await fetch('/api/payments/upload-target', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: file.name, type: file.type, size: file.size, salesOrderNumber: linked ? salesOrderNumber : '', uploadScope }) }); const targetJson = await targetResponse.json().catch(() => ({})); if (!targetResponse.ok || !targetJson.ok) throw new Error(targetJson.error || 'Could not prepare upload'); uploadScope = targetJson.data.uploadScope; const uploadResponse = await fetch(targetJson.data.uploadUrl, { method: 'PUT', headers: { 'content-type': targetJson.data.uploadContentType }, body: file }).catch(() => null); if (!uploadResponse?.ok) throw new Error(`Upload failed for ${file.name}`); attachments.push({ key: targetJson.data.key, name: file.name }) }
      for (const file of files) await uploadOne(file)
      const response = await fetch('/api/payments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(linked ? { salesOrderId: selectedOrder!.id, salesOrderNumber } : {}), customerName: linked ? selectedOrder!.customerName : manualCustomer, paymentAmount: amount, paymentMode, addedBy, attachments, uploadScope, remarks }) })
      const json = await response.json().catch(() => ({}))
      if (!response.ok || !json.ok) throw new Error(json.error || 'Could not add payment')
      setPayments((items) => sortPayments([json.data.payment, ...items]))
      resetPaymentForm(); setOpen(false)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not add payment') }
    finally { setBusy(false) }
  }

  async function setStatus(id: string, status: PaymentStatus) {
    if (!isAdmin && !isAccounts) return
    const previous = payments
    setError(''); setUpdatingPaymentId(id)
    setPayments((items) => sortPayments(items.map((item) => item.id === id ? { ...item, status } : item)))
    try {
      const response = await fetch('/api/payments', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, status }) })
      const json = await response.json().catch(() => ({}))
      if (!response.ok || !json.ok) throw new Error(json.error || 'Could not update status')
      setPayments((items) => sortPayments(items.map((item) => item.id === id ? json.data.payment : item)))
    } catch (reason) {
      setPayments(previous); setError(reason instanceof Error ? reason.message : 'Could not update status')
    } finally { setUpdatingPaymentId('') }
  }

  return <section className="payments-page">
    <header className="payments-header"><div><h1>Payments</h1><p className="muted">Track customer payment proofs and receipt status.</p></div><div className="payments-header-actions"><div className="notification-center"><button className="notification-bell" type="button" onClick={() => { setNotificationsOpen((value) => !value); void refreshNotifications() }} aria-expanded={notificationsOpen} aria-haspopup="dialog" aria-label={`Payment notifications, ${unreadCount} unread`} title="Payment notifications"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>{unreadCount > 0 && <span className="notification-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}</button>{notificationsOpen && <section className="notification-panel" role="dialog" aria-label="Payment notifications"><header><div><strong>Notifications</strong><span>{unreadCount ? `${unreadCount} unread` : 'All caught up'}</span></div>{unreadCount > 0 && <button type="button" onClick={() => void markNotificationRead()}>Mark all read</button>}</header><div className="notification-list">{notifications.length === 0 ? <div className="notification-empty"><strong>No payment notifications</strong><span>New payment alerts will appear here.</span></div> : notifications.map((notification) => <button type="button" key={notification.id} className={notification.readAt ? 'notification-item' : 'notification-item unread'} onClick={() => void openNotification(notification)}><span className="notification-dot" aria-hidden="true" /><span className="notification-copy"><strong>New payment · {notification.salesOrderNumber}</strong><span>{notification.customerName} · {formatAmount(notification.paymentAmount)}</span><time>{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(notification.createdAt))}</time></span></button>)}</div></section>}</div>{isAdmin && <><button className="payment-sync-button" type="button" disabled={syncing} onClick={() => void syncOpenOrders()} aria-label="Sync open Zoho sales orders" title={syncing ? 'Syncing open Zoho sales orders' : 'Sync open Zoho sales orders'}><span aria-hidden="true" className={syncing ? 'payment-sync-icon spinning' : 'payment-sync-icon'}>↻</span></button><span className="payment-action-gap" aria-hidden="true" /><button className="btn red" onClick={() => { setError(''); setSyncMessage(''); setOpen(true) }}>+ Add Payment</button></>}</div></header>
    {(isAdmin || isAccounts) && pushState !== 'enabled' && pushState !== 'checking' && <div className="notification-consent"><div><strong>Get new payment alerts</strong><span>{pushState === 'unsupported' ? 'This browser does not support Web Push. On iPhone/iPad, install the site to your Home Screen, then try again.' : pushState === 'denied' ? 'Notifications are blocked. Allow them in your browser settings, then use the bell.' : 'Enable mobile or desktop notifications when a new payment needs approval.'}</span></div>{pushState !== 'unsupported' && pushState !== 'denied' && <button className="btn red" type="button" disabled={pushBusy} onClick={() => void enablePush()}>{pushBusy ? 'Enabling…' : 'Enable notifications'}</button>}<button className="drawer-close" aria-label="Dismiss notification prompt" type="button" onClick={() => { localStorage.setItem('payment-push-consent-dismissed', '1'); setPushState('checking') }}>×</button></div>}
    {syncMessage && <div className="form-success payments-error">{syncMessage}</div>}
    {error && !open && <div className="form-error payments-error">{error}</div>}
    <div className="card payments-card">
      {payments.length === 0 ? <div className="payments-empty"><strong>No payments added yet</strong><span>Payment records will appear here after you add the first record.</span></div> : <><div className="payments-table-wrap"><table className="payments-table"><thead><tr><th>Date</th><th>Sales Order</th><th>Customer Name</th><th>Mode</th><th>Amount</th><th>Proofs</th><th>Remarks</th><th className="payments-actions-heading"><span>Status</span></th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id} data-payment-id={payment.id} className={payment.status === 'Payment Received' ? 'payment-row-received' : 'payment-row-pending'}><td>{formatPaymentDate(payment.createdAt)}</td><td>{payment.salesOrderNumber || 'No Sales Order'}</td><td>{payment.customerName}<small className="payment-added-by">Added by {payment.addedBy || '—'}</small></td><td>{payment.paymentMode || '—'}</td><td>{formatAmount(payment.paymentAmount)}</td><td>{payment.attachments?.length ? <button type="button" className="payment-proof-link" onClick={() => setViewer(payment.attachments!.map((proof) => ({ name: proof.name, contentType: proof.contentType, url: proof.url })))}>View Proof{payment.attachments.length > 1 ? `s (${payment.attachments.length})` : ''}</button> : <span className="payment-no-attachment">—</span>}</td><td className="payment-remarks" title={payment.remarks || ''}>{payment.remarks || '—'}</td><td className="payment-status-cell"><div className="payment-status-control"><select className={`payment-status-select ${payment.status === 'Payment Received' ? 'received' : 'pending'}`} aria-label={`Status for ${payment.salesOrderNumber || 'No Sales Order'}`} title="Update payment status" value={payment.status} disabled={updatingPaymentId === payment.id} onChange={(event) => void setStatus(payment.id, event.target.value as PaymentStatus)}><option value="Pending">Pending</option><option value="Payment Received">Received</option></select></div></td></tr>)}</tbody></table></div><div className="payment-mobile-list">{payments.map((payment) => { const proofUrl = payment.screenshotKey ? `/api/r2/view?key=${encodeURIComponent(payment.screenshotKey)}` : payment.screenshotUrl; return <article key={payment.id} data-payment-id={payment.id} className={`payment-mobile-card ${payment.status === 'Payment Received' ? `received${isAccounts ? ' accounts-received' : ''}` : 'pending'}`}><div className="payment-mobile-top"><h2>{payment.salesOrderNumber || 'No Sales Order'}</h2><time dateTime={payment.createdAt}>{formatPaymentDate(payment.createdAt)}</time></div><div className="payment-mobile-primary payment-mobile-details"><p>{payment.customerName}</p><small className="payment-added-by">Added by {payment.addedBy || '—'}</small><span>{payment.paymentMode || 'Mode unavailable'}</span><strong>{formatAmount(payment.paymentAmount)}</strong></div><div className="payment-mobile-footer">{payment.attachments?.length ? <button type="button" className="payment-mobile-proof" aria-label={`View payment proof${payment.attachments.length > 1 ? `s, ${payment.attachments.length} attachments` : ''}`} onClick={() => setViewer(payment.attachments!.map((proof) => ({ name: proof.name, contentType: proof.contentType, url: proof.url })))}><svg className="payment-mobile-proof-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.75" /></svg><span>Screenshot</span>{payment.attachments.length > 1 && <small className="payment-mobile-proof-count">{payment.attachments.length}</small>}</button> : <span className="payment-mobile-no-proof">No proof</span>}<div className={`payment-mobile-status-control ${payment.status === 'Payment Received' ? 'received' : 'pending'}`}><select className="payment-mobile-status" aria-label={`Status for ${payment.salesOrderNumber || 'No Sales Order'}`} value={payment.status} disabled={updatingPaymentId === payment.id} onChange={(event) => void setStatus(payment.id, event.target.value as PaymentStatus)}><option value="Pending">Pending</option><option value="Payment Received">Received</option></select></div></div></article> })}</div></>}
    </div>
    {isAdmin && open && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="add-payment-title"><section className="order-modal card payment-modal"><div className="modal-head"><div><p className="eyebrow">New record</p><h1 id="add-payment-title">Add Payment</h1></div><button className="drawer-close" type="button" aria-label="Close" disabled={busy} onClick={closePaymentForm}>×</button></div>
      <form className="payment-form" onSubmit={addPayment}>
        <label>Sales Order (optional)<div className="payment-order-combobox"><div className="payment-order-input-row"><input role="combobox" autoComplete="off" aria-autocomplete="list" aria-expanded={suggestionsOpen} aria-controls="payment-order-options" aria-activedescendant={suggestionsOpen && matchingOrders[activeSuggestion] ? `payment-order-${matchingOrders[activeSuggestion].id}` : undefined} value={salesOrderNumber} onFocus={interactWithOrder} onClick={interactWithOrder} onBlur={() => setTimeout(() => setSuggestionsOpen(false), 100)} onKeyDown={handleOrderKeyDown} onChange={(event) => { setOrderInteracted(true); setSalesOrderNumber(event.target.value); setSelectedOrderNumber(''); setSelectedOrder(null); setCustomerName(''); setActiveSuggestion(0); setSuggestionsOpen(true) }} placeholder="Search by SO number or customer" />{selectedOrder && <><span className={`payment-order-chip ${selectedOrder.status === 'Closed' ? 'closed' : selectedOrder.status === 'Open' ? 'open' : 'unknown'}`} title={selectedOrder.rawStatus || selectedOrder.status}>{selectedOrder.status}</span><button type="button" aria-label="Clear selected sales order" onClick={clearOrder}>×</button></>}</div>{suggestionsOpen && <div className="payment-order-options" id="payment-order-options" role="listbox">{ordersLoading ? <div className="payment-order-message">Loading sales orders…</div> : matchingOrders.length ? matchingOrders.map((order, index) => <button id={`payment-order-${order.id}`} role="option" aria-selected={index === activeSuggestion} className={index === activeSuggestion ? 'active' : ''} type="button" key={order.id} onMouseDown={(event) => event.preventDefault()} onClick={() => selectOrder(order)}><span><strong>{order.salesOrderNumber}</strong><small>{order.customerName}</small></span><em className={`payment-order-chip ${order.status === 'Closed' ? 'closed' : order.status === 'Open' ? 'open' : 'unknown'}`} title={order.rawStatus || order.status}>{order.status}</em></button>) : <div className="payment-order-message">No matching sales orders</div>}</div>}<span className="field-help">No sales order? Leave this blank and enter the customer name.</span></div></label>
        <label>Customer Name<input required maxLength={120} readOnly={Boolean(selectedOrder)} value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder={selectedOrder ? 'Linked to selected sales order' : 'Enter customer name'} /></label>
        <label>Payment Amount (₹)<input required type="text" inputMode="decimal" pattern="[0-9]+(?:\.[0-9]{1,2})?" value={paymentAmount} onChange={(event) => { const nextAmount = event.target.value; if (/^\d*(?:\.\d{0,2})?$/.test(nextAmount)) setPaymentAmount(nextAmount) }} placeholder="Enter payment amount" /></label>
        <label>Payment Mode<select required value={paymentMode} onChange={(event) => setPaymentMode(event.target.value as PaymentMode)}>{PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select></label>
        <label>Added by<select className="payment-added-by-select" required value={addedBy} onChange={(event) => setAddedBy(event.target.value as PaymentAddedBy | '')}><option value="">Select user</option>{PAYMENT_ADDED_BY_USERS.map((user) => <option key={user} value={user}>{user}</option>)}</select></label>
        <label><span className="payment-field-label">Add images or PDFs <span className="field-help">(required) · Up to 10 images or PDFs • 10 MB each</span></span><input ref={fileInputRef} required type="file" multiple accept="image/png,image/jpeg,image/webp,image/heic,image/heif,application/pdf,.pdf" aria-label="Add images or PDFs" onChange={(event) => { try { const incoming = Array.from(event.target.files || []).map(normalizePaymentScreenshotFile); setFiles((current) => { const keys = new Set(current.map((item) => `${item.name}:${item.size}:${item.lastModified}`)); const next = [...current, ...incoming.filter((item) => !keys.has(`${item.name}:${item.size}:${item.lastModified}`))]; if (next.length > 10) { setError('You can attach up to 10 files.'); return current } return next }); event.target.value = '' } catch (reason) { setError(reason instanceof Error ? reason.message : 'Invalid proof') } }} />{files.length > 0 && <div className="payment-file-queue"><strong>{files.length}/10 selected</strong>{files.map((item, index) => <div key={`${item.name}-${item.size}-${item.lastModified}`}><span title={item.name}>{item.name}</span><button type="button" aria-label={`Remove ${item.name}`} onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}</div>}</label>
        <label>Remarks <span className="field-help">(optional)</span><textarea maxLength={500} rows={3} value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Add any payment details or notes…" />{remarks.length >= 400 && <span className="field-help">{remarks.length}/500</span>}</label>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions"><button className="btn" type="button" disabled={busy} onClick={closePaymentForm}>Cancel</button><button className="btn red" type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Submit Payment'}</button></div>
      </form>
    </section></div>}
    {viewer && <PaymentProofViewer proofs={viewer} onClose={() => setViewer(null)} />}
  </section>
}
