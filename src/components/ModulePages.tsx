import { Badge } from '@/components/DashboardShell'
import { machines, mediaQueue, packagingQueue, vehicleQueue } from '@/lib/mock-data'

export const moduleCopy = {
  qr: { active: 'QR & Serial', title: 'QR & Serial' },
  wooden: { active: 'Wooden Packing', title: 'Wooden Packing' },
  media: { active: 'Packing Video', title: 'Packing Video' },
  vehicle: { active: 'Vehicle & Transportation', title: 'Vehicle & Transportation' },
  lookup: { active: 'Machine Lookup', title: 'Machine Lookup' },

}

export function ModuleHeader({ moduleKey }: { moduleKey: keyof typeof moduleCopy }) {
  const item = moduleCopy[moduleKey]
  return <header className="top compact-top"><div><h1 className="h1">{item.title}</h1></div><button className="btn light sync-icon-btn" aria-label="Sync" title="Sync">⟳</button></header>
}

export function QueueTable({ kind }: { kind: 'qr' | 'wooden' | 'media' | 'vehicle' | 'lookup' }) {
  const rows = kind === 'media' ? mediaQueue : kind === 'vehicle' ? vehicleQueue : kind === 'wooden' ? packagingQueue : machines
  return (
    <section className="card">
      <h2>{kind === 'lookup' ? 'Machines' : 'Queue'}</h2>
      <div className="desktop-table table-wrap"><table className="table"><thead><tr><th>Serial</th><th>SO</th><th>Customer</th><th>Item</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map((m) => <tr key={m.id}><td><strong>{m.serialNumber || 'Pending'}</strong></td><td>{m.salesOrderNumber}</td><td>{m.customerName}</td><td>{m.itemName}</td><td><Badge tone={m.status === 'Dispatched' ? 'green' : m.status === 'Review Required' ? 'red' : 'blue'}>{kind === 'wooden' ? m.woodenPacking : kind === 'media' ? `${m.mediaPhotos}P · ${m.mediaVideos}V` : m.status}</Badge></td><td><a className="btn light" href={`/m/${m.qrToken || m.serialNumber}`}>Open</a></td></tr>)}</tbody></table></div>
      <div className="mobile-cards module-mobile-list">{rows.map((m) => <article className="card mobile-order-card" key={m.id}><strong>{m.serialNumber || 'Pending'}</strong><div className="meta-grid"><div><span>SO</span><strong>{m.salesOrderNumber}</strong></div><div><span>Status</span><strong>{m.status}</strong></div></div><a className="btn light full" href={`/m/${m.qrToken || m.serialNumber}`}>Open</a></article>)}</div>
    </section>
  )
}


