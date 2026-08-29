'use client'

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './submit-payment.module.css'
import { normalizePaymentScreenshotFile } from '@/lib/payment-screenshot'
import { PaymentProofViewer, type ViewerProof } from '@/components/PaymentProofViewer'
import { PAYMENT_ADDED_BY_USERS, type PaymentAddedBy } from '@/lib/payments'

type Order = { id: string; salesOrderNumber: string; customerName: string; status: 'Open' | 'Closed' | 'Status unknown'; rawStatus: string }
type Receipt = { id: string; salesOrderNumber?: string; paymentAmount: number; status: 'Pending' }
type Payment = { id: string; date: string; salesOrderNumber?: string; customerName: string; paymentMode: string | null; paymentAmount: number | null; status: 'Pending' | 'Payment Received'; addedBy: PaymentAddedBy | null; hasScreenshot: boolean; proofUrl: string | null; remarks: string | null; attachments: ViewerProof[] }
type Api<T> = { ok: boolean; data?: T; error?: string }
type Capabilities = Record<string, string>
const CAPABILITY_KEY = 'bsm-public-payment-delete-capabilities-v1'
const normalizeListSearch = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
const money = (amount: number | null) => amount == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount)
const date = (value: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value))

function readCapabilities(): Capabilities {
  try { const value = JSON.parse(localStorage.getItem(CAPABILITY_KEY) || '{}'); return value && typeof value === 'object' ? value : {} } catch { return {} }
}

export default function PublicPaymentForm() {
  const [payments, setPayments] = useState<Payment[]>([])
  const [listReady, setListReady] = useState(false)
  const [capabilities, setCapabilities] = useState<Capabilities>({})
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Payment | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [toast, setToast] = useState('')
  const [listSearch, setListSearch] = useState('')
  const [userFilter, setUserFilter] = useState<PaymentAddedBy | ''>('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [open, setOpen] = useState(false)
  const [orders, setOrders] = useState<Order[]>([])
  const [token, setToken] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Order | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [orderInteracted, setOrderInteracted] = useState(false)
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState('')
  const [addedBy, setAddedBy] = useState<PaymentAddedBy | ''>('')
  const [files, setFiles] = useState<File[]>([])
  const [remarks, setRemarks] = useState('')
  const [viewer, setViewer] = useState<ViewerProof[] | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [fileAnnouncement, setFileAnnouncement] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const searchCache = useRef(new Map<string, Order[]>())
  const polling = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const orderRequest = useRef<{ controller: AbortController; generation: number } | null>(null)
  const requestGeneration = useRef(0)
  const modalHistory = useRef(false)
  const dragDepth = useRef(0)

  useEffect(() => { setCapabilities(readCapabilities()) }, [])
  // The same short-lived signed session used by submission is CSRF proof for legacy deletion.

  useEffect(() => {
    const closeMenus = (event: PointerEvent) => { if (!(event.target as Element).closest('[data-payment-menu]')) setOpenMenu(null); if (!(event.target as Element).closest('[data-user-filter]')) setFilterOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpenMenu(null); setFilterOpen(false); if (!deleteBusy) setDeleting(null) } }
    document.addEventListener('pointerdown', closeMenus); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', closeMenus); document.removeEventListener('keydown', escape) }
  }, [deleteBusy])

  useEffect(() => {
    if (!open) return
    const closeOrders = (event: PointerEvent) => { if (!(event.target as Element).closest(`.${styles.searchWrap}`)) setSuggestionsOpen(false) }
    document.addEventListener('pointerdown', closeOrders)
    return () => document.removeEventListener('pointerdown', closeOrders)
  }, [open])

  const refreshPayments = useCallback(async () => {
    if (polling.current) return
    polling.current = true
    try {
      const response = await fetch('/api/public/payments', { cache: 'no-store' })
      const json: Api<{ payments: Payment[] }> = await response.json()
      if (!response.ok || !json.data) throw new Error(json.error || 'Could not load payments')
      setPayments(json.data.payments)
    } catch { /* silent polling retry */ }
    finally { polling.current = false; setListReady(true) }
  }, [])

  useEffect(() => {
    void refreshPayments()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refreshPayments() }, 5000)
    const focus = () => void refreshPayments()
    window.addEventListener('focus', focus)
    return () => { clearInterval(timer); window.removeEventListener('focus', focus) }
  }, [refreshPayments])

  const resetPaymentForm = useCallback(() => {
    orderRequest.current?.controller.abort(); orderRequest.current = null; requestGeneration.current += 1
    setQuery(''); setSelected(null); setCustomerName(''); setOrderInteracted(false); setAmount(''); setMode(''); setAddedBy(''); setFiles([]); setRemarks(''); setToken(''); setOrders([])
    setBusy(false); setError(''); setReceipt(null); setSuggestionsOpen(false); setSyncing(false); setOrdersLoading(false); setSyncMessage(''); setDragActive(false); setFileAnnouncement(''); dragDepth.current = 0
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const attachPaymentProof = useCallback((candidates: File[]) => {
    try {
      if (!candidates.length) throw new Error('Folders cannot be attached. Choose images or PDFs.')
      const normalized = candidates.map(normalizePaymentScreenshotFile)
      setFiles((current) => { const keys = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`)); const additions = normalized.filter((file) => !keys.has(`${file.name}:${file.size}:${file.lastModified}`)); if (current.length + additions.length > 10) { setError('You can attach up to 10 files.'); return current } return [...current, ...additions] })
      setError(''); setFileAnnouncement(`${normalized.length} file${normalized.length === 1 ? '' : 's'} attached.`)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return true
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not attach payment proof.'
      if (fileInputRef.current) fileInputRef.current.value = ''
      setError(message); setFileAnnouncement(message); return false
    }
  }, [])

  useEffect(() => {
    if (!open || receipt) return
    const containsFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes('Files')
    const enter = (event: DragEvent) => { if (!containsFiles(event)) return; event.preventDefault(); dragDepth.current += 1; setDragActive(true) }
    const over = (event: DragEvent) => { if (!containsFiles(event)) return; event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy' }
    const leave = (event: DragEvent) => { if (!containsFiles(event)) return; event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragActive(false) }
    const drop = (event: DragEvent) => {
      event.preventDefault(); event.stopPropagation(); dragDepth.current = 0; setDragActive(false)
      const items = Array.from(event.dataTransfer?.items || []).filter((item) => item.kind === 'file')
      const files = Array.from(event.dataTransfer?.files || [])
      if (items.length && !files.length) return void attachPaymentProof([])
      attachPaymentProof(files)
    }
    window.addEventListener('dragenter', enter); window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop)
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); dragDepth.current = 0 }
  }, [open, receipt, attachPaymentProof])

  async function loadForm(force = false, search = '') {
    orderRequest.current?.controller.abort()
    const controller = new AbortController(); const generation = ++requestGeneration.current
    orderRequest.current = { controller, generation }
    setError('')
    setOrdersLoading(true); if (force) setSyncing(true)
    const timeout = window.setTimeout(() => controller.abort('timeout'), force ? 60_000 : 8_000)
    try {
      const params = new URLSearchParams({ limit: search ? '25' : '10' }); if (search) params.set('q', search); if (force) params.set('refresh', '1')
      const response = await fetch(`/api/public/payments/orders?${params}`, { cache: 'no-store', signal: controller.signal })
      const json: Api<{ orders: Order[]; submissionToken: string }> = await response.json()
      if (!response.ok || !json.data) throw new Error(json.error || 'Could not load sales orders')
      if (generation !== requestGeneration.current || controller.signal.aborted) return
      setOrders(json.data.orders); searchCache.current.set(search, json.data.orders); setToken(json.data.submissionToken)
      if (force) setSyncMessage('Sales-order search index refreshed')
    } catch (cause) {
      if (generation !== requestGeneration.current) return
      setSyncMessage(''); setError(controller.signal.aborted ? 'Sales-order lookup timed out. Please retry.' : cause instanceof Error ? cause.message : 'Could not load form')
    } finally { clearTimeout(timeout); if (generation === requestGeneration.current) { setOrdersLoading(false); if (force) setSyncing(false) } }
  }
  useEffect(() => () => orderRequest.current?.controller.abort(), [])
  useEffect(() => {
    if (!open || selected || !orderInteracted) return
    const search = query.trim()
    const cached = searchCache.current.get(search)
    if (cached) { setOrders(cached); return }
    const timer = window.setTimeout(() => void loadForm(false, search), search ? 225 : 0)
    return () => window.clearTimeout(timer)
  }, [open, query, selected, orderInteracted])
  useEffect(() => {
    const back = () => { if (modalHistory.current) { modalHistory.current = false; resetPaymentForm(); setOpen(false) } }
    window.addEventListener('popstate', back); return () => window.removeEventListener('popstate', back)
  }, [resetPaymentForm])
  const matches = useMemo(() => orders, [orders])
  const visiblePayments = useMemo(() => {
    const needle = normalizeListSearch(listSearch)
    return payments.filter((payment) => {
      if (userFilter && payment.addedBy !== userFilter) return false
      if (!needle) return true
      return normalizeListSearch([
        payment.salesOrderNumber || 'No Sales Order', payment.customerName,
        payment.remarks, payment.addedBy,
      ].join(' ')).includes(needle)
    })
  }, [payments, listSearch, userFilter])
  function choose(order: Order) { setSelected(order); setQuery(order.salesOrderNumber); setCustomerName(order.customerName); setSuggestionsOpen(false); setError('') }
  function clearOrder() { setSelected(null); setQuery(''); setCustomerName(''); setSuggestionsOpen(false) }
  function showSuggestions() { setOrderInteracted(true); setSuggestionsOpen(true); if (!orders.length) void loadForm(false, query.trim()) }
  function openPaymentForm() { resetPaymentForm(); setOpen(true); modalHistory.current = true; history.pushState({ paymentModal: true }, ''); void loadForm() }
  function close() { if (!busy) { resetPaymentForm(); setOpen(false); if (modalHistory.current) { modalHistory.current = false; history.back() } } }
  function again() { resetPaymentForm(); void loadForm() }

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    const linked = Boolean(selected && query === selected.salesOrderNumber)
    const manualCustomer = customerName.trim()
    if (!manualCustomer || manualCustomer.length > 120 || /[\u0000-\u001f\u007f-\u009f<>]/u.test(manualCustomer)) return setError('Enter a valid customer name (maximum 120 characters).')
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) return setError('Enter a valid amount with up to 2 decimal places.')
    if (!mode) return setError('Select a payment mode.')
    if (!addedBy) return setError('Select who added the payment.')
    if (files.length < 1 || files.length > 10) return setError('Attach between 1 and 10 payment proofs.')
    setBusy(true)
    try {
      const uploaded: { key: string; name: string }[] = []
      let uploadScope = ''
      const uploadOne = async (file: File) => {
        const targetResponse = await fetch('/api/public/payments/upload-target', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: file.name, type: file.type, size: file.size, salesOrderNumber: linked ? selected!.salesOrderNumber : '', uploadScope, submissionToken: token }) })
        const targetJson: Api<{ key: string; uploadUrl: string; uploadContentType: string; uploadScope: string }> = await targetResponse.json().catch(() => ({} as Api<never>))
        if (!targetResponse.ok || !targetJson.data) throw new Error(targetJson.error || 'Could not prepare proof upload')
        const upload = await fetch(targetJson.data.uploadUrl, { method: 'PUT', headers: { 'content-type': targetJson.data.uploadContentType }, body: file }).catch(() => null)
        if (!upload?.ok) throw new Error(`Upload failed for ${file.name}. Check your connection and retry.`)
        uploadScope = targetJson.data.uploadScope; uploaded.push({ key: targetJson.data.key, name: file.name })
      }
      for (const file of files) await uploadOne(file)
      const response = await fetch('/api/public/payments', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID().replaceAll('-', '') }, body: JSON.stringify({ ...(linked ? { salesOrderId: selected!.id, salesOrderNumber: selected!.salesOrderNumber } : {}), customerName: linked ? selected!.customerName : manualCustomer, paymentAmount: amount, paymentMode: mode, addedBy, attachments: uploaded, uploadScope, remarks, submissionToken: token, website: '' }) })
      const json: Api<{ receipt: Receipt; deleteToken?: string }> = await response.json()
      if (!response.ok || !json.data) throw new Error(json.error || 'Payment could not be submitted')
      if (json.data.deleteToken) {
        const next = { ...readCapabilities(), [json.data.receipt.id]: json.data.deleteToken }
        localStorage.setItem(CAPABILITY_KEY, JSON.stringify(next)); setCapabilities(next)
      }
      const submittedReceipt = json.data.receipt; resetPaymentForm(); setReceipt(submittedReceipt); await refreshPayments()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Payment could not be submitted') }
    finally { setBusy(false) }
  }

  async function deletePayment() {
    if (!deleting) return
    const capability = capabilities[deleting.id] || ''
    setDeleteBusy(true); setDeleteError('')
    try {
      const sessionToken = token || await fetch('/api/public/payments/orders', { cache: 'no-store' }).then((response) => response.json()).then((json: Api<{ submissionToken: string }>) => json.data?.submissionToken || '')
      const response = await fetch(`/api/public/payments/${encodeURIComponent(deleting.id)}`, { method: 'DELETE', headers: { 'x-payment-delete-token': capability, 'x-public-submission-token': sessionToken } })
      const json: Api<{ deleted: boolean }> = await response.json().catch(() => ({} as Api<never>))
      if (!response.ok) throw new Error(json.error || 'Could not delete payment. Please retry.')
      setPayments((items) => items.filter((item) => item.id !== deleting.id))
      const next = { ...capabilities }; delete next[deleting.id]
      localStorage.setItem(CAPABILITY_KEY, JSON.stringify(next)); setCapabilities(next)
      setOpenMenu(null); setDeleting(null); setToast('Payment deleted')
      window.setTimeout(() => setToast(''), 2400)
    } catch (cause) { setDeleteError(cause instanceof Error ? cause.message : 'Could not delete payment. Please retry.') }
    finally { setDeleteBusy(false) }
  }

  const menu = (payment: Payment) => payment.status === 'Pending' ? <div className={styles.menuWrap} data-payment-menu>
    <button className={styles.menuButton} type="button" aria-label={`Actions for ${payment.salesOrderNumber || 'No Sales Order'}`} aria-expanded={openMenu === payment.id} onClick={() => setOpenMenu((id) => id === payment.id ? null : payment.id)}><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>
    {openMenu === payment.id && <div className={styles.menu} role="menu"><button type="button" role="menuitem" onClick={() => { setDeleting(payment); setDeleteError(''); setOpenMenu(null) }}>Delete</button></div>}
  </div> : null

  return <main className={styles.shell}>
    <section className={styles.page}>
      <header className={styles.header}><div><p className={styles.eyebrow}>Finance</p><h1>Payments</h1><p className={styles.lead}>Submit customer payments and wait for approval.</p></div><div className={styles.headerActions}><button className={styles.sync} type="button" title="Sync sales orders" aria-label="Sync sales orders" disabled={syncing} onClick={() => void loadForm(true)}><svg className={syncing ? styles.spinning : ''} viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5M4 18v-5h5M6.1 9A7 7 0 0 1 18 6.5L20 11M4 13l2 4.5A7 7 0 0 0 17.9 15"/></svg></button><button className={styles.add} type="button" onClick={openPaymentForm}>+ Add Payment</button></div></header>
      {(syncMessage || (!open && error)) && <p className={error ? styles.syncError : styles.syncSuccess} role="status">{error || syncMessage}</p>}
      <div className={styles.listTools}>
        <div className={styles.paymentSearch}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input type="search" value={listSearch} onChange={(event) => setListSearch(event.target.value)} aria-label="Search payments" placeholder="Search payments" />{listSearch && <button type="button" aria-label="Clear payment search" onClick={() => setListSearch('')}>×</button>}</div>
        <div className={styles.userFilter} data-user-filter>
          <button className={styles.filterButton} type="button" aria-label="Filter payments by added-by user" aria-haspopup="menu" aria-expanded={filterOpen} onClick={() => setFilterOpen((value) => !value)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>{userFilter && <span className={styles.filterDot}/>}</button>
          {filterOpen && <div className={styles.filterPopover} role="menu" aria-label="Added by"><strong>Added by</strong>{(['', ...PAYMENT_ADDED_BY_USERS] as const).map((user) => <button type="button" role="menuitemradio" aria-checked={userFilter === user} key={user || 'all'} onClick={() => { setUserFilter(user); setFilterOpen(false) }}><span>{user || 'All users'}</span>{userFilter === user && <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>}</button>)}</div>}
        </div>
        {userFilter && <button type="button" className={styles.filterChip} aria-label={`Clear ${userFilter} filter`} onClick={() => setUserFilter('')}>{userFilter} <span aria-hidden="true">×</span></button>}
        <span className={styles.resultCount}>{visiblePayments.length} payment{visiblePayments.length === 1 ? '' : 's'}</span>
      </div>
      <section className={styles.listCard} aria-live="polite">
        {listReady && visiblePayments.length === 0 ? <div className={styles.empty}><strong>No payments found</strong><span>{payments.length ? 'Try another search or user filter.' : 'New payment records will appear here.'}</span></div> : <>
          <div className={styles.tableWrap}><table><thead><tr><th>Date</th><th>Sales Order</th><th>Customer Name</th><th>Mode</th><th>Amount</th><th>Proofs</th><th>Remarks</th><th>Status</th><th className={styles.actionHead}>Actions</th></tr></thead><tbody>{visiblePayments.map((payment) => <tr key={payment.id} className={payment.status === 'Payment Received' ? styles.receivedRow : ''}><td>{date(payment.date)}</td><td><strong>{payment.salesOrderNumber || 'No Sales Order'}</strong></td><td>{payment.customerName}<small className={styles.addedBy}>Added by {payment.addedBy || '—'}</small></td><td>{payment.paymentMode || '—'}</td><td>{money(payment.paymentAmount)}</td><td>{payment.attachments?.length ? <button type="button" className={styles.proof} onClick={() => setViewer(payment.attachments)}>View Proof{payment.attachments.length > 1 ? `s (${payment.attachments.length})` : ''}</button> : '—'}</td><td title={payment.remarks || ''}>{payment.remarks || '—'}</td><td><span className={payment.status === 'Payment Received' ? styles.received : styles.pending}>{payment.status === 'Payment Received' ? 'Received' : 'Pending'}</span></td><td className={styles.actionCell}>{menu(payment)}</td></tr>)}</tbody></table></div>
          <div className={styles.mobileList}>{visiblePayments.map((payment) => <article key={payment.id} className={payment.status === 'Payment Received' ? styles.receivedCard : styles.mobileCard}><div className={styles.cardTop}><strong>{payment.salesOrderNumber || 'No Sales Order'}</strong><small>{date(payment.date)}</small></div><div className={styles.cardMiddle}><h2>{payment.customerName}</h2><span>{payment.paymentMode || 'Mode unavailable'}</span><b>{money(payment.paymentAmount)}</b></div><small className={styles.addedBy}>Added by {payment.addedBy || '—'}</small>{payment.remarks && <p title={payment.remarks}>{payment.remarks}</p>}<div className={styles.cardBottom}>{payment.attachments?.length ? <button type="button" className={styles.proof} onClick={() => setViewer(payment.attachments)}>View Proof{payment.attachments.length > 1 ? `s (${payment.attachments.length})` : ''}</button> : <span className={styles.noProof}>No proof</span>}<div className={styles.mobileTools}><span className={payment.status === 'Payment Received' ? styles.received : styles.pending}>{payment.status === 'Payment Received' ? 'Received' : 'Pending'}</span>{menu(payment)}</div></div></article>)}</div>
        </>}
      </section>
    </section>
    {toast && <div className={styles.toast} role="status">✓ {toast}</div>}
    {deleting && <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="delete-payment-title"><section className={`${styles.modal} ${styles.deleteModal}`}><div className={styles.deleteIcon}>!</div><h2 id="delete-payment-title">Delete payment?</h2><p>This removes the pending submission and its screenshot. This action cannot be undone.</p><dl><div><dt>Sales Order</dt><dd>{deleting.salesOrderNumber}</dd></div><div><dt>Customer</dt><dd>{deleting.customerName}</dd></div><div><dt>Amount</dt><dd>{money(deleting.paymentAmount)}</dd></div></dl>{deleteError && <p className={styles.error} role="alert">{deleteError}</p>}<div className={styles.actions}><button type="button" className={styles.cancel} disabled={deleteBusy} onClick={() => setDeleting(null)}>Cancel</button><button type="button" className={styles.deleteButton} disabled={deleteBusy} onClick={() => void deletePayment()}>{deleteBusy ? 'Deleting…' : 'Delete Payment'}</button></div></section></div>}
    {open && <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="add-payment-title"><section className={styles.modal}>
      {dragActive && <div className={styles.dropOverlay} role="status" aria-live="assertive"><div className={styles.dropPrompt}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg><strong>Drop payment proof</strong><span>Image or PDF • Max 10 MB</span></div></div>}
      <span className={styles.srOnly} role="status" aria-live="polite">{fileAnnouncement}</span>
      {receipt ? <div className={styles.success}><button className={styles.close} onClick={close} aria-label="Close">×</button><div className={styles.successIcon}>✓</div><h2>Payment submitted</h2><p>Your payment is safely queued for approval.</p><dl><div><dt>Sales Order</dt><dd>{receipt.salesOrderNumber || 'No Sales Order'}</dd></div><div><dt>Amount</dt><dd>{money(receipt.paymentAmount)}</dd></div><div><dt>Status</dt><dd><span className={styles.pending}>Pending</span></dd></div></dl><button className={styles.add} onClick={again}>Submit another payment</button></div> : <><header className={styles.modalHead}><div><p className={styles.eyebrow}>New record</p><h2 id="add-payment-title">Add Payment</h2></div><button className={styles.close} type="button" onClick={close} disabled={busy} aria-label="Close">×</button></header><form onSubmit={submit} noValidate>
        <label>Sales Order (optional)</label><div className={styles.searchWrap}><div className={styles.orderInputRow}><input role="combobox" aria-expanded={suggestionsOpen} aria-controls="public-payment-order-options" value={query} onFocus={showSuggestions} onClick={showSuggestions} onKeyDown={(event) => { if (event.key === 'Escape') setSuggestionsOpen(false) }} onChange={(e) => { setOrderInteracted(true); setQuery(e.target.value); setSelected(null); setCustomerName(''); setSuggestionsOpen(true) }} placeholder="Search by SO number or customer" autoComplete="off" />{selected && <><span className={`${styles.orderStatus} ${selected.status === 'Closed' ? styles.orderClosed : selected.status === 'Open' ? styles.orderOpen : styles.orderUnknown}`} title={selected.rawStatus || selected.status}>{selected.status}</span><button type="button" aria-label="Clear selected sales order" onClick={clearOrder}>×</button></>}</div>{suggestionsOpen && !selected && <div id="public-payment-order-options" className={styles.suggestions}>{ordersLoading ? <p>Loading sales orders…</p> : matches.length ? matches.map((order) => <button type="button" key={order.id} onClick={() => choose(order)}><span><strong>{order.salesOrderNumber}</strong><small>{order.customerName}</small></span><em className={`${styles.orderStatus} ${order.status === 'Closed' ? styles.orderClosed : order.status === 'Open' ? styles.orderOpen : styles.orderUnknown}`} title={order.rawStatus || order.status}>{order.status}</em></button>) : error ? <p>Could not load orders. <button type="button" onClick={() => void loadForm(true)}>Retry</button></p> : <p>No matching sales orders.</p>}</div>}<small>No sales order? Leave this blank and enter the customer name.</small></div>
        <label htmlFor="customer-name">Customer Name<span>*</span></label><input id="customer-name" required maxLength={120} readOnly={Boolean(selected)} value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder={selected ? 'Linked to selected sales order' : 'Enter customer name'} />
        <label htmlFor="amount">Payment Amount<span>*</span></label><div className={styles.amount}><b>₹</b><input id="amount" type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" /></div>
        <label htmlFor="mode">Payment Mode<span>*</span></label><select id="mode" value={mode} onChange={(e) => setMode(e.target.value)}><option value="">Select payment mode</option>{['Bank Transfer', 'UPI', 'Cash', 'Credit Card', 'Debit Card', 'Other'].map((item) => <option key={item}>{item}</option>)}</select>
        <label htmlFor="added-by">Added by<span>*</span></label><div className={styles.selectWrap}><select id="added-by" required value={addedBy} onChange={(e) => setAddedBy(e.target.value as PaymentAddedBy | '')}><option value="">Select user</option>{PAYMENT_ADDED_BY_USERS.map((user) => <option key={user} value={user}>{user}</option>)}</select></div>
        <label htmlFor="shot">Payment Proof<span>*</span></label><label className={`${styles.upload} ${files.length ? styles.uploadSuccess : ''}`} htmlFor="shot"><b>{files.length ? `✓ ${files.length}/10 selected` : 'Add images or PDFs'}</b><small>Up to 10 images or PDFs • 10 MB each</small></label><input ref={fileInputRef} className={styles.file} id="shot" type="file" required multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.pdf" onChange={(e) => attachPaymentProof(Array.from(e.target.files || []))} />{files.length > 0 && <div className={styles.fileQueue}>{files.map((item, index) => <div key={`${item.name}-${item.size}-${item.lastModified}`}><span title={item.name}>{item.name} · {(item.size / 1048576).toFixed(1)} MB</span><button type="button" aria-label={`Remove ${item.name}`} onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}</div>}
        <label htmlFor="remarks">Remarks <em>Optional</em></label><textarea id="remarks" maxLength={500} rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Add any payment details or notes…" />{remarks.length >= 400 && <small>{remarks.length}/500</small>}
        <input className={styles.trap} name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />{error && <p className={styles.error} role="alert">{error}</p>}<div className={styles.actions}><button type="button" className={styles.cancel} onClick={close}>Cancel</button><button className={styles.add} disabled={busy || !token}>{busy ? 'Submitting…' : 'Submit Payment'}</button></div>
      </form></>}
    </section></div>}
    {viewer && <PaymentProofViewer proofs={viewer} onClose={() => setViewer(null)} />}
  </main>
}
