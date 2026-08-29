'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { safeLocalStorageSet } from '@/lib/safe-local-storage'
import { Badge } from '@/components/DashboardShell'

const WOODEN_CACHE_KEY = 'bsm.wooden.requirements.v2'
const WOODEN_STATUS_KEY = 'bsm.wooden.status.v2'
const OLD_WOODEN_STATUS_KEY = 'bsm.wooden.status.v1'
const WOODEN_AUTO_SYNC_MS = 30 * 60 * 1000
type WoodenStatus = 'Required' | 'Ordered'
type WoodenItem = { id: string; salesOrderNumber: string; customerName: string; itemName: string; requiredQuantity: number }
type WoodenQueue = { lastSuccessAt?: string | null; items: WoodenItem[] }
type ConsolidatedRow = { itemName: string; totalQuantity: number; salesOrders: string; customers: string; status: string }

export function WoodenPackingClient({ initialQueue = { items: [] } }: { initialQueue?: WoodenQueue }) {
  const [queue, setQueue] = useState<WoodenQueue>(initialQueue)
  const [statuses, setStatuses] = useState<Record<string, WoodenStatus>>({})
  const [syncing, setSyncing] = useState(false)
  const syncingRef = useRef(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const cached = readCache()
    if (cached.items.length > initialQueue.items.length) setQueue(cached)
    setStatuses(readStatuses(cached.items.length ? cached.items : initialQueue.items))
    void loadSaved()
  }, [initialQueue.items])

  useEffect(() => {
    const timer = window.setInterval(() => { void syncZoho(false) }, WOODEN_AUTO_SYNC_MS)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = queue.items || []
  const grouped = useMemo(() => {
    const map = new Map<string, WoodenItem[]>()
    rows.forEach((row) => map.set(row.salesOrderNumber, [...(map.get(row.salesOrderNumber) || []), row]))
    return [...map.entries()].sort(([a, aItems], [b, bItems]) => {
      const aStatus = statuses[a] || 'Required'
      const bStatus = statuses[b] || 'Required'
      if (aStatus !== bStatus) return aStatus === 'Required' ? -1 : 1
      return a.localeCompare(b) || (aItems[0]?.customerName || '').localeCompare(bItems[0]?.customerName || '')
    })
  }, [rows, statuses])
  const requiredRows = useMemo(() => rows.filter((row) => (statuses[row.salesOrderNumber] || 'Required') === 'Required'), [rows, statuses])
  const consolidated = useMemo(() => consolidateRows(requiredRows), [requiredRows])
  const pendingRequiredTotal = useMemo(() => requiredRows.reduce((sum, row) => sum + Number(row.requiredQuantity || 0), 0), [requiredRows])

  async function loadSaved() {
    try {
      const response = await fetch('/api/wooden-packing', { cache: 'no-store' })
      const json = await response.json()
      const saved = json.data?.queue || { items: [] }
      setQueue(saved); safeLocalStorageSet(WOODEN_CACHE_KEY, JSON.stringify(saved))
      setStatuses((current) => ({ ...readStatuses(saved.items), ...current }))
    } catch {}
  }

  async function syncZoho(showError = true) {
    if (syncingRef.current) return
    syncingRef.current = true
    setSyncing(true); setError('')
    const visibleSpin = showError ? new Promise((resolve) => window.setTimeout(resolve, 800)) : Promise.resolve()
    try {
      const response = await fetch('/api/wooden-packing', { method: 'POST', cache: 'no-store' })
      await visibleSpin
      const json = await response.json()
      const next = json.data?.queue
      if (!response.ok || !json.ok) throw new Error(json.error || 'Wooden Packing sync failed. Showing the last successfully synced data.')
      setQueue(next); safeLocalStorageSet(WOODEN_CACHE_KEY, JSON.stringify(next))
    } catch (err) {
      if (showError) setError(err instanceof Error ? err.message : 'Wooden Packing sync failed. Showing the last successfully synced data.')
      await loadSaved()
    } finally { syncingRef.current = false; setSyncing(false) }
  }

  function updateStatus(salesOrderNumber: string, status: WoodenStatus) {
    const next = { ...statuses, [salesOrderNumber]: status }
    setStatuses(next)
    safeLocalStorageSet(WOODEN_STATUS_KEY, JSON.stringify(next))
  }

  return <>
    <header className="top compact-top wooden-mobile-head"><div><h1 className="h1">Wooden Packing</h1></div><button type="button" className={`btn light wooden-sync-btn${syncing ? ' syncing' : ''}`} aria-label="Sync wooden packing" title="Sync wooden packing" onClick={() => syncZoho(true)} disabled={syncing}><span aria-hidden="true">⟳</span></button></header>
    {error && <div className="form-error">{error}</div>}
    <section className="card wooden-summary-export"><div><span>Pending</span><strong>{pendingRequiredTotal}</strong></div><div className="tabs wooden-export-actions"><button className="btn light" onClick={() => printConsolidated(consolidated)}>Print</button><button className="btn red" onClick={() => downloadXlsx('wooden-packing-consolidated-requirements.xlsx', consolidated)}>Download</button></div></section>
    <section className="card"><h2>Pending Wooden Packing</h2>{syncing && <div className="machine-row compact"><span>Syncing complete Zoho wooden packing queue</span><Badge>Live</Badge></div>}<div className="machine">{grouped.map(([so, items]) => { const status = statuses[so] || 'Required'; return <div className={`machine-row wooden-order-row ${status === 'Ordered' ? 'ordered' : 'required'}`} key={so}><div><strong>{so}</strong><p className="muted">{items[0]?.customerName}</p><div className="wooden-item-list">{items.map((item) => <p className="wooden-item-line" key={item.id}><span title={item.itemName}>{item.itemName}</span><strong>× {item.requiredQuantity}</strong></p>)}</div></div><select className={`status-select ${status === 'Ordered' ? 'green' : 'required'}`} value={status} onChange={(event) => updateStatus(so, event.target.value as WoodenStatus)} aria-label={`Wooden packing status for ${so}`}><option>Required</option><option>Ordered</option></select></div> })}</div></section>
  </>
}

function consolidateRows(rows: WoodenItem[]): ConsolidatedRow[] {
  const map = new Map<string, { itemName: string; totalQuantity: number; salesOrders: Set<string>; customers: Set<string> }>()
  for (const row of rows) {
    const key = row.itemName.trim().toLowerCase()
    const entry = map.get(key) || { itemName: row.itemName, totalQuantity: 0, salesOrders: new Set<string>(), customers: new Set<string>() }
    entry.totalQuantity += Number(row.requiredQuantity || 0)
    entry.salesOrders.add(row.salesOrderNumber)
    if (row.customerName) entry.customers.add(row.customerName)
    map.set(key, entry)
  }
  return [...map.values()].sort((a, b) => a.itemName.localeCompare(b.itemName)).map((entry) => ({ itemName: entry.itemName, totalQuantity: entry.totalQuantity, salesOrders: [...entry.salesOrders].join(', '), customers: [...entry.customers].join(', '), status: 'Required' }))
}

function xlsTable(rows: ConsolidatedRow[]) {
  const esc = (value: string | number) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<table><thead><tr><th>Machine / Item</th><th>Total Wooden Boxes Required</th><th>Sales Orders</th><th>Customers</th><th>Status</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${esc(row.itemName)}</td><td>${esc(row.totalQuantity)}</td><td>${esc(row.salesOrders)}</td><td>${esc(row.customers)}</td><td>${esc(row.status)}</td></tr>`).join('')}</tbody></table>`
}

function downloadXlsx(fileName: string, rows: ConsolidatedRow[]) {
  const sheetRows = [['Machine / Item', 'Total Wooden Boxes Required', 'Sales Orders', 'Customers', 'Status'], ...rows.map((row) => [row.itemName, row.totalQuantity, row.salesOrders, row.customers, row.status])]
  const files: Record<string, string> = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Wooden Packing" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': worksheetXml(sheetRows),
  }
  const url = URL.createObjectURL(new Blob([zipStore(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url; a.download = fileName; a.click(); URL.revokeObjectURL(url)
}

function worksheetXml(rows: (string | number)[][]) {
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => `<c r="${columnName(c)}${r + 1}" t="inlineStr"><is><t>${xmlEsc(value)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`
}
function xmlEsc(value: string | number) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
function columnName(index: number) { let name = ''; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name; return name }
function zipStore(files: Record<string, string>) {
  const encoder = new TextEncoder(); const local: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name); const data = encoder.encode(content); const crc = crc32(data)
    local.push(zipHeader(0x04034b50, nameBytes, data.length, crc)); local.push(nameBytes); local.push(data)
    central.push(zipHeader(0x02014b50, nameBytes, data.length, crc, offset)); central.push(nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0); const total = offset + centralSize + 22; const out = new Uint8Array(total); let cursor = 0
  for (const part of [...local, ...central]) { out.set(part, cursor); cursor += part.length }
  const end = new DataView(out.buffer, cursor, 22); end.setUint32(0, 0x06054b50, true); end.setUint16(8, Object.keys(files).length, true); end.setUint16(10, Object.keys(files).length, true); end.setUint32(12, centralSize, true); end.setUint32(16, offset, true)
  return out
}
function zipHeader(sig: number, name: Uint8Array, size: number, crc: number, offset = 0) { const central = sig === 0x02014b50; const bytes = new Uint8Array(central ? 46 : 30); const v = new DataView(bytes.buffer); v.setUint32(0, sig, true); if (central) { v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint32(16, crc, true); v.setUint32(20, size, true); v.setUint32(24, size, true); v.setUint16(28, name.length, true); v.setUint32(42, offset, true) } else { v.setUint16(4, 20, true); v.setUint32(14, crc, true); v.setUint32(18, size, true); v.setUint32(22, size, true); v.setUint16(26, name.length, true) } return bytes }
function crc32(data: Uint8Array) { let crc = -1; for (const b of data) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)) } return (crc ^ -1) >>> 0 }

function printConsolidated(rows: ConsolidatedRow[]) {
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(`<!doctype html><html><head><title>Wooden Packing Requirements</title><style>body{font-family:Arial,sans-serif;padding:24px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:10px;text-align:left}th{background:#f1f5f9}</style></head><body><h1>Wooden Packing Requirements</h1>${xlsTable(rows)}</body></html>`)
  win.document.close(); win.focus(); win.print()
}

function readCache(): WoodenQueue { try { return JSON.parse(localStorage.getItem(WOODEN_CACHE_KEY) || '{"items":[]}') as WoodenQueue } catch { return { items: [] } } }
function readStatuses(rows: WoodenItem[] = []): Record<string, WoodenStatus> {
  try {
    const current = JSON.parse(localStorage.getItem(WOODEN_STATUS_KEY) || '{}') as Record<string, WoodenStatus>
    if (Object.keys(current).length) return current
    const old = JSON.parse(localStorage.getItem(OLD_WOODEN_STATUS_KEY) || '{}') as Record<string, string>
    const migrated: Record<string, WoodenStatus> = {}
    for (const [salesOrderNumber, items] of rows.reduce((map, row) => map.set(row.salesOrderNumber, [...(map.get(row.salesOrderNumber) || []), row]), new Map<string, WoodenItem[]>())) {
      migrated[salesOrderNumber] = items.some((item) => old[item.id] === 'Ordered' || old[item.id] === 'Completed') ? 'Ordered' : 'Required'
    }
    if (Object.keys(migrated).length) safeLocalStorageSet(WOODEN_STATUS_KEY, JSON.stringify(migrated))
    return migrated
  } catch { return {} }
}
