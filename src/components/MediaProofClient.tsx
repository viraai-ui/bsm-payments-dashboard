'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/DashboardShell'
import type { Order } from '@/types/domain'
import type { MediaProofRecord, MediaUpload } from '@/lib/media-proof'
import { mediaStatusForOrder, mediaTone } from '@/lib/status-projection'

const LOADING_ORDER_UNIT_ID = 'loading-order'
const MAX_LOADING_VIDEOS = 5
const VIDEO_ACCEPT = 'video/*,.mp4,.mov,.m4v,.3gp,.3gpp,.webm'

type MediaRecords = Record<string, MediaProofRecord>
type MediaMode = 'packing' | 'loading'

export function MediaProofClient({ initialOrders = [], initialRecords = {}, title = 'Packing Video', apiPath = '/api/media-proof', mode = 'packing' }: { initialOrders?: Order[]; initialRecords?: MediaRecords; title?: string; apiPath?: string; mode?: MediaMode }) {
  const [orders, setOrders] = useState<Order[]>(initialOrders)
  const [records, setRecords] = useState<MediaRecords>(initialRecords)
  const [active, setActive] = useState<Order | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { void loadQueue() }, [])

  async function loadQueue() {
    setError('')
    try {
      const response = await fetch(apiPath, { cache: 'no-store' })
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error || 'Could not load video queue')
      setOrders(json.data.orders || [])
      setRecords(json.data.records || {})
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load video queue') }
  }

  function status(order: Order) {
    return mediaStatusForOrder(order, records[order.id])
  }

  const pendingOrders = mode === 'packing' ? orders.filter((order) => !records[order.id]?.submittedAt) : orders
  const submittedOrders = mode === 'packing' ? orders.filter((order) => records[order.id]?.submittedAt) : []

  return <>
    {error && <div className="form-error">{error}</div>}
    <section className="card media-queue-card">
      <div className="media-queue-head"><h2>{title} Queue</h2><Badge tone="blue">{orders.length} orders</Badge></div>
      <div className="desktop-table table-wrap"><table className="table"><thead><tr><th>SO</th>{mode === 'loading' && <th>Customer</th>}<th>Delivery</th><th>Status</th><th>Action</th></tr></thead><tbody>{pendingOrders.map((order) => <QueueRow key={order.id} order={order} record={records[order.id]} mode={mode} status={status(order)} onOpen={() => setActive(order)} />)}{submittedOrders.length > 0 && <tr className="media-section-row"><td colSpan={mode === 'loading' ? 5 : 4}>Submitted Videos</td></tr>}{submittedOrders.map((order) => <QueueRow key={order.id} order={order} record={records[order.id]} mode={mode} status={status(order)} onOpen={() => setActive(order)} />)}</tbody></table></div>
      <div className="mobile-cards media-order-list">{pendingOrders.map((order) => <OrderCard key={order.id} order={order} record={records[order.id]} mode={mode} status={status(order)} onOpen={() => setActive(order)} />)}{submittedOrders.length > 0 && <div className="media-submitted-section-title">Submitted Videos</div>}{submittedOrders.map((order) => <OrderCard key={order.id} order={order} record={records[order.id]} mode={mode} status={status(order)} onOpen={() => setActive(order)} />)}</div>
      {!orders.length && <div className="empty-state"><strong>No orders pending</strong><span className="muted">Everything is clear here.</span></div>}
    </section>
    {active && <MediaModal order={active} record={records[active.id]} apiPath={apiPath} title={title} mode={mode} onClose={() => setActive(null)} onChanged={(record) => setRecords((prev) => ({ ...prev, [active.id]: record }))} onSubmitted={(orderId) => { setOrders((prev) => mode === 'packing' ? [...prev].sort((a, b) => a.id === orderId ? 1 : b.id === orderId ? -1 : 0) : prev.filter((order) => order.id !== orderId)); setActive(null) }} />}
  </>
}

function QueueRow({ order, record, mode, status, onOpen }: { order: Order; record?: MediaProofRecord; mode: MediaMode; status: string; onOpen: () => void }) {
  const done = Boolean(record?.submittedAt)
  return <tr className={mode === 'packing' && done ? 'media-submitted-row' : ''}><td><strong>{order.salesOrderNumber}</strong></td>{mode === 'loading' && <td>{order.customerName}</td>}<td>{order.deliveryDate}</td><td><Badge tone={mediaTone(status as any)}>{status}</Badge></td><td><button className="btn light" onClick={onOpen}>Open</button></td></tr>
}

function OrderCard({ order, record, mode, status, onOpen }: { order: Order; record?: MediaProofRecord; mode: MediaMode; status: string; onOpen: () => void }) {
  const uploaded = mode === 'loading' ? (record?.units?.[LOADING_ORDER_UNIT_ID]?.videos?.length || 0) : order.machines.reduce((sum, machine) => sum + Math.min(1, record?.units?.[machine.id]?.videos?.length || 0), 0)
  const total = mode === 'loading' ? MAX_LOADING_VIDEOS : order.machines.length
  const done = Boolean(record?.submittedAt)
  return <article className={`card mobile-order-card media-mobile-order-card ${mode === 'packing' && done ? 'submitted' : ''}`} onClick={onOpen}>
    <div><strong>{order.salesOrderNumber}</strong><span>{mode === 'loading' ? order.customerName : (order.salesperson || 'Salesperson —')}</span></div><small className="media-count-pill">{mode === 'loading' ? `${uploaded}/${total} videos` : `${total} Item Videos`}</small>
    <div className="media-card-meta"><Badge tone={mediaTone(status as any)}>{status}</Badge></div>
    <button className="btn light tiny-view" onClick={(event) => { event.stopPropagation(); onOpen() }}>View</button>
  </article>
}

function MediaModal({ order, record, apiPath, title, mode, onClose, onChanged, onSubmitted }: { order: Order; record?: MediaProofRecord; apiPath: string; title: string; mode: MediaMode; onClose: () => void; onChanged: (record: MediaProofRecord) => void; onSubmitted: (orderId: string) => void }) {
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [progressByUnit, setProgressByUnit] = useState<Record<string, number>>({})
  const loadingVideos = record?.units?.[LOADING_ORDER_UNIT_ID]?.videos || []
  const uploadedPackingVideos = useMemo(() => order.machines.reduce((sum, machine) => sum + (record?.units?.[machine.id]?.videos?.length || 0), 0), [order, record])
  const ready = useMemo(() => mode === 'loading' ? loadingVideos.length > 0 && loadingVideos.length <= MAX_LOADING_VIDEOS : uploadedPackingVideos > 0, [mode, loadingVideos.length, uploadedPackingVideos])

  async function upload(unitId: string, files: FileList | File[] | null) {
    if (!files?.length) return
    const selected = Array.from(files).map((file, index) => normalizeCameraVideoFile(file, order.salesOrderNumber, unitId, index))
    if (mode === 'loading' && loadingVideos.length + selected.length > MAX_LOADING_VIDEOS) { setMessage(`Maximum ${MAX_LOADING_VIDEOS} loading videos allowed`); return }
    setBusy(unitId); setMessage(''); setProgressByUnit((prev) => ({ ...prev, [unitId]: 1 }))
    try {
      for (const file of selected) {
        if (!file.size) throw new Error('The recorded video file is empty. Please record again or choose it from Gallery.')
        if (!file.type.startsWith('video/')) throw new Error('This file is not detected as a video. Please try Gallery if camera upload fails.')
        const json = await uploadVideoFile(order, unitId, file, apiPath, mode, (percent) => setProgressByUnit((prev) => ({ ...prev, [unitId]: percent })))
        onChanged(json.data.record)
      }
      setProgressByUnit((prev) => ({ ...prev, [unitId]: 100 }))
      setMessage('Video uploaded successfully.')
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Upload failed') }
    finally { setBusy('') }
  }

  async function deleteVideo(unitId: string, videoId: string) {
    if (!window.confirm('Delete this uploaded video?')) return
    setBusy(`delete-${videoId}`); setMessage('')
    try {
      const response = await fetch(apiPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'delete_video', orderId: order.id, machineId: unitId, videoId }) })
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error || 'Delete failed')
      onChanged(json.data.record)
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Delete failed') }
    finally { setBusy('') }
  }

  async function submit() {
    if (!window.confirm(`Submit ${title.toLowerCase()} for ${order.salesOrderNumber}?`)) return
    setBusy('submit'); setMessage('')
    try {
      const response = await fetch(apiPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'submit', orderId: order.id }) })
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error || 'Submit failed')
      onChanged(json.data.record)
      onSubmitted(order.id)
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Submit failed') }
    finally { setBusy('') }
  }

  async function proceedWithoutVideo() {
    if (!window.confirm(`Proceed ${order.salesOrderNumber} without video?`)) return
    setBusy('skip'); setMessage('')
    try {
      const response = await fetch(apiPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'proceed_without_video', orderId: order.id }) })
      const json = await response.json()
      if (!response.ok || !json.ok) throw new Error(json.error || 'Proceed without video failed')
      onChanged(json.data.record)
      onSubmitted(order.id)
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Proceed without video failed') }
    finally { setBusy('') }
  }

  return <div className="modal-backdrop media-modal-backdrop" role="dialog" aria-modal="true"><section className="order-modal card media-mobile-modal"><div className="modal-head media-modal-head"><div><h1>{order.salesOrderNumber}</h1><p className="muted">{mode === 'loading' ? order.customerName : title}</p>{mode === 'packing' && <p className="media-salesperson-line">Salesperson: <strong>{order.salesperson || '—'}</strong></p>}</div><button className="drawer-close" onClick={onClose}>×</button></div><div className="media-modal-body">{message && <div className={message.includes('success') ? 'form-success' : 'form-error'}>{message}</div>}{mode === 'loading' ? <LoadingVideoPanel order={order} videos={loadingVideos} busy={busy} progress={progressByUnit[LOADING_ORDER_UNIT_ID] || 0} onUpload={(files) => upload(LOADING_ORDER_UNIT_ID, files)} onDelete={(videoId) => deleteVideo(LOADING_ORDER_UNIT_ID, videoId)} /> : <PackingVideoPanel order={order} record={record} busy={busy} progressByUnit={progressByUnit} onUpload={upload} onDelete={deleteVideo} />}</div><section className="modal-actions media-submit-bar"><button className="btn light" disabled={Boolean(busy) || Boolean(record?.submittedAt)} onClick={proceedWithoutVideo}>Skip</button><button className="btn red" disabled={!ready || Boolean(busy) || Boolean(record?.submittedAt)} onClick={submit}>{record?.submittedAt ? 'Submitted' : busy === 'submit' ? 'Submitting…' : 'Submit'}</button></section></section></div>
}

function LoadingVideoPanel({ order, videos, busy, progress, onUpload, onDelete }: { order: Order; videos: MediaUpload[]; busy: string; progress: number; onUpload: (files: FileList | File[] | null) => void; onDelete: (videoId: string) => void }) {
  const remaining = MAX_LOADING_VIDEOS - videos.length
  return <section className="loading-video-panel loading-final-panel"><div className="loading-order-summary"><div><span>Sales Order</span><strong>{order.salesOrderNumber}</strong></div><div><span>Customer</span><strong>{order.customerName}</strong></div></div><div className="loading-machine-list"><h2>Machines</h2>{order.lineItems?.length ? order.lineItems.map((item) => <div className="loading-machine-row" key={item.id}><strong>{item.itemName}</strong><span>Qty {item.quantity || item.pendingQuantity || 1}</span></div>) : order.machines.map((machine) => <div className="loading-machine-row" key={machine.id}><strong>{machine.itemName}</strong><span>Qty 1</span></div>)}</div><div className="loading-video-drop final-upload"><div><strong>Final Loading Video</strong><span>{videos.length}/{MAX_LOADING_VIDEOS} uploaded</span></div><VideoUploadChoices disabled={remaining <= 0 || Boolean(busy)} onUpload={onUpload} galleryMultiple />{busy === LOADING_ORDER_UNIT_ID && <div className="mobile-upload-progress"><span>Uploading {progress || 0}%</span><progress value={progress || 0} max={100} /></div>}</div><Previews files={videos} onDelete={onDelete} busy={busy} /></section>
}

function PackingVideoPanel({ order, record, busy, progressByUnit, onUpload, onDelete }: { order: Order; record?: MediaProofRecord; busy: string; progressByUnit: Record<string, number>; onUpload: (unitId: string, files: FileList | File[] | null) => void; onDelete: (unitId: string, videoId: string) => void }) {
  return <><div className="desktop-table table-wrap"><table className="table"><thead><tr><th>Unit</th><th>Serial</th><th>Video</th><th>Upload</th></tr></thead><tbody>{order.machines.map((machine) => <tr key={machine.id}><td>{machine.itemName}</td><td>{machine.serialNumber || '—'}</td><td><Previews files={record?.units?.[machine.id]?.videos || []} onDelete={(videoId) => onDelete(machine.id, videoId)} busy={busy} /></td><td><VideoUploadChoices disabled={Boolean(busy)} onUpload={(files) => onUpload(machine.id, files)} galleryMultiple />{busy === machine.id && <span className="muted"> Uploading {progressByUnit[machine.id] || 0}%</span>}</td></tr>)}</tbody></table></div><div className="media-unit-cards">{order.machines.map((machine, index) => { const videos = record?.units?.[machine.id]?.videos || []; return <article className="media-unit-card" key={machine.id}><div className="media-unit-top"><i>{index + 1}</i><div><strong>{machine.itemName}</strong><div className="media-unit-meta"><span className="serial-chip">Serial: {machine.serialNumber || '—'}</span>{videos.length === 0 && <em>No videos yet</em>}</div></div></div>{videos.length > 0 && <span className="upload-check">✓</span>}<Previews files={videos} onDelete={(videoId) => onDelete(machine.id, videoId)} busy={busy} /><VideoUploadChoices disabled={Boolean(busy)} onUpload={(files) => onUpload(machine.id, files)} galleryMultiple />{busy === machine.id && <div className="mobile-upload-progress"><span>Uploading {progressByUnit[machine.id] || 0}%</span><progress value={progressByUnit[machine.id] || 0} max={100} /></div>}</article> })}</div></>
}

function VideoUploadChoices({ disabled, onUpload, galleryMultiple = false }: { disabled?: boolean; onUpload: (files: FileList | File[] | null) => void; galleryMultiple?: boolean }) {
  const recordInputRef = useRef<HTMLInputElement | null>(null)
  const galleryInputRef = useRef<HTMLInputElement | null>(null)

  function uploadImmediately(files: FileList | null) {
    if (!files?.length) return
    onUpload(files)
  }

  return <div className="video-upload-choices"><label className={`video-choice-btn record ${disabled ? 'disabled' : ''}`}><span aria-hidden="true">📹</span><strong>Record Video</strong><input ref={recordInputRef} className="file-input-native" disabled={disabled} type="file" accept={VIDEO_ACCEPT} capture="environment" onChange={(event) => { uploadImmediately(event.target.files); event.target.value = '' }} /></label><label className={`video-choice-btn gallery ${disabled ? 'disabled' : ''}`}><span aria-hidden="true">▣</span><strong>Gallery</strong><input ref={galleryInputRef} className="file-input-native" disabled={disabled} type="file" accept={VIDEO_ACCEPT} multiple={galleryMultiple} onChange={(event) => { uploadImmediately(event.target.files); event.target.value = '' }} /></label></div>
}

function Previews({ files, onDelete, busy }: { files: MediaUpload[]; onDelete?: (videoId: string) => void; busy?: string }) { return <div className="preview-strip media-preview-strip">{files.length ? files.map((file, index) => <span key={file.id} className="media-preview-chip"><a href={file.workdriveUrl || file.url} target="_blank">Video {index + 1}</a>{file.expiresAt && <small className="muted">expires {new Date(file.expiresAt).toLocaleDateString('en-IN')}</small>}{onDelete && <button type="button" className="media-delete-video" disabled={busy === `delete-${file.id}`} onClick={() => onDelete(file.id)} aria-label={`Delete Video ${index + 1}`}>×</button>}</span>) : <em>No videos yet</em>}</div> }

async function uploadVideoFile(order: Order, unitId: string, file: File, apiPath: string, mode: MediaMode, onProgress: (percent: number) => void): Promise<any> {
  try {
    return await uploadDirectToR2(order, unitId, file, apiPath, mode, onProgress)
  } catch (error) {
    // Vercel request bodies are capped well below normal mobile video sizes.
    // Never turn an actionable direct-R2 error into a second opaque NetworkError.
    if (file.size > 4 * 1024 * 1024) throw error
    onProgress(3)
    return uploadViaServer(order, unitId, file, mode, onProgress)
  }
}

function normalizeCameraVideoFile(file: File, salesOrderNumber: string, unitId: string, index: number) {
  const type = file.type && file.type.startsWith('video/') ? file.type : 'video/mp4'
  const extension = extensionForVideoType(type)
  const originalName = file.name && file.name.trim() ? file.name.trim() : ''
  const safeName = originalName && /\.[a-z0-9]{2,5}$/i.test(originalName) ? originalName : `${salesOrderNumber}-${unitId}-${Date.now()}-${index + 1}.${extension}`
  if (file.name === safeName && file.type === type) return file
  return new File([file], safeName, { type, lastModified: file.lastModified || Date.now() })
}

function extensionForVideoType(type: string) {
  if (type.includes('quicktime')) return 'mov'
  if (type.includes('webm')) return 'webm'
  if (type.includes('3gpp')) return '3gp'
  return 'mp4'
}

async function uploadDirectToR2(order: Order, unitId: string, file: File, apiPath: string, mode: MediaMode, onProgress: (percent: number) => void): Promise<any> {
  const contentType = file.type || 'video/mp4'
  const targetResponse = await fetch('/api/r2/upload-target', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId: order.id, machineId: unitId, name: file.name, type: contentType, size: file.size, stage: mode }) })
  const targetJson = await parseJsonResponse(targetResponse, 'R2 upload target unavailable')
  if (!targetResponse.ok || !targetJson.ok) throw new Error(targetJson.error || 'R2 upload target unavailable')
  const target = targetJson.data
  if (target.corsReady === false) throw new Error(target.corsError || 'Cloudflare R2 bucket CORS is not configured for dispatch.bsmindia.com. Please add the R2 CORS policy and try again.')
  await uploadBlobToR2(target.uploadUrl, file, contentType, onProgress)
  const registered = await fetch(apiPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'register_r2_video', orderId: order.id, machineId: unitId, name: file.name, type: contentType, r2Key: target.key, url: target.publicUrl, expiresAt: target.expiresAt }) })
  const json = await parseJsonResponse(registered, 'Could not register R2 video')
  if (!registered.ok || !json.ok) throw new Error(json.error || 'Could not register R2 video')
  return json
}

async function uploadViaServer(order: Order, unitId: string, file: File, mode: MediaMode, onProgress: (percent: number) => void): Promise<any> {
  const form = new FormData()
  form.append('orderId', order.id)
  form.append('machineId', unitId)
  form.append('stage', mode)
  form.append('file', file, file.name || 'gallery-video.mp4')
  onProgress(5)
  const response = await fetch('/api/media-proof/upload', { method: 'POST', body: form })
  onProgress(response.ok ? 100 : 5)
  const json = await parseJsonResponse(response, 'Fallback video upload failed')
  if (!response.ok || !json.ok) throw new Error(json.error || 'Fallback video upload failed')
  return json
}

async function parseJsonResponse(response: Response, fallback: string): Promise<any> {
  try { return await response.json() }
  catch { return { ok: false, error: `${fallback}: server returned an invalid response (HTTP ${response.status})` } }
}

function uploadBlobToR2(uploadUrl: string, file: File, contentType: string, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const timeout = window.setTimeout(() => { xhr.abort(); reject(new Error('Upload is taking too long or got stuck. Please check internet and try again, or upload a shorter video.')) }, 600000)
    xhr.open('PUT', uploadUrl)
    xhr.setRequestHeader('content-type', contentType)
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.max(1, Math.min(95, Math.round((event.loaded / event.total) * 100)))) }
    xhr.onload = () => { window.clearTimeout(timeout); if (xhr.status >= 200 && xhr.status < 300) { onProgress(100); resolve() } else reject(new Error(`Cloudflare R2 upload failed: HTTP ${xhr.status}. Please try again.`)) }
    xhr.onerror = () => { window.clearTimeout(timeout); reject(new Error('Upload failed due to network connection. Please try again on stronger internet.')) }
    xhr.onabort = () => { window.clearTimeout(timeout); reject(new Error('Upload was cancelled or timed out. Please retry.')) }
    xhr.send(file)
  })
}
