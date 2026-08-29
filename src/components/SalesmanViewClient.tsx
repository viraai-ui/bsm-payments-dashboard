'use client'

import { useState } from 'react'
import type { SalesmanDispatchOrder, SalesmanShipmentOrder } from '@/lib/salesman-view'

type SalesmanData = {
  generatedAt: string
  totals: {
    dispatchOrders: number
    dispatchMachines: number
    urgentOrders: number
    urgentMachines: number
    regularOrders: number
    regularMachines: number
    shipmentOrders: number
    shipmentMachines: number
    totalWorkloadMachines: number
  }
  urgentOrders: SalesmanDispatchOrder[]
  regularOrders: SalesmanDispatchOrder[]
  shipmentOrders: SalesmanShipmentOrder[]
}

export function SalesmanViewClient({ initialData, publicMode = false, title = 'Salesman View' }: { initialData: SalesmanData | null; publicMode?: boolean; title?: string }) {
  const [data, setData] = useState(initialData)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const urgentPct = data?.totals.totalWorkloadMachines ? Math.round((data.totals.urgentMachines / data.totals.totalWorkloadMachines) * 100) : 0
  const regularPct = data?.totals.totalWorkloadMachines ? Math.round((data.totals.regularMachines / data.totals.totalWorkloadMachines) * 100) : 0
  const shipmentPct = data?.totals.totalWorkloadMachines ? Math.max(0, 100 - urgentPct - regularPct) : 0

  async function refresh() {
    setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/salesman-view', { cache: 'no-store' })
      const json = await response.json().catch(() => ({}))
      if (!response.ok || !json.ok) throw new Error(json.error || 'Could not refresh Salesman View')
      setData(json.data)
      setMessage('Updated')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not refresh') }
    finally { setBusy(false) }
  }

  if (!data) return <section className="salesman-view-page"><div className="empty-state"><strong>Admin access required</strong></div></section>

  return <section className={`salesman-view-page clean-salesman-view ${publicMode ? 'public-salesman-view' : ''}`}>
    <header className="salesman-hero card">
      <div><h1>{title}</h1></div>
      {!publicMode && <button className={`btn red salesman-refresh ${busy ? 'spinning' : ''}`} type="button" disabled={busy} onClick={refresh}>{busy ? 'Refreshing…' : 'Refresh'}</button>}
    </header>
    {message && <div className={message === 'Updated' ? 'form-success' : 'form-error'}>{message}</div>}

    <div className="salesman-summary-grid">
      <section className="card salesman-summary-card dispatch">
        <div className="salesman-section-head"><h2>Dispatch Orders</h2><strong>{data.totals.dispatchOrders} Sales Orders • {data.totals.dispatchMachines} Machines</strong></div>
        <div className="salesman-summary-split">
          <SummaryBlock tone="urgent" label="Urgent" orders={data.totals.urgentOrders} machines={data.totals.urgentMachines} />
          <SummaryBlock tone="regular" label="Regular" orders={data.totals.regularOrders} machines={data.totals.regularMachines} />
        </div>
      </section>
      <section className="card salesman-summary-card shipment">
        <div className="salesman-section-head"><h2>Shipment Queue</h2><strong>{data.totals.shipmentOrders} Sales Orders • {data.totals.shipmentMachines} Machines</strong></div>
        <SummaryBlock tone="shipment" label="Ready to Ship" orders={data.totals.shipmentOrders} machines={data.totals.shipmentMachines} />
      </section>
    </div>

    <section className="card salesman-workload-card compact glass">
      <div className="salesman-workload-title"><h2>Workload Split</h2><strong>{data.totals.totalWorkloadMachines} machines</strong></div>
      <div className="salesman-workload-bar" aria-label="Workload split"><i className="urgent" style={{ width: `${urgentPct}%` }} /><i className="regular" style={{ width: `${regularPct}%` }} /><i className="shipment" style={{ width: `${shipmentPct}%` }} /></div>
      <div className="salesman-legend"><span><i className="urgent" />Urgent {data.totals.urgentMachines}</span><span><i className="regular" />Regular {data.totals.regularMachines}</span><span><i className="shipment" />Shipment {data.totals.shipmentMachines}</span></div>
    </section>

    <div className="salesman-columns">
      <OrderPanel title="Urgent Dispatch Orders" tone="urgent" orders={data.urgentOrders} empty="No urgent dispatch workload" />
      <OrderPanel title="Regular Dispatch Orders" tone="regular" orders={data.regularOrders} empty="No regular dispatch workload" />
      <ShipmentPanel orders={data.shipmentOrders} />
    </div>
  </section>
}

function SummaryBlock({ label, orders, machines, tone }: { label: string; orders: number; machines: number; tone: 'urgent' | 'regular' | 'shipment' }) {
  return <article className={`salesman-summary-block ${tone}`}><span>{label}</span><div><strong>{orders}</strong><em>Sales Orders</em></div><div><strong>{machines}</strong><em>Machines</em></div></article>
}

function OrderPanel({ title, tone, orders, empty }: { title: string; tone: 'urgent' | 'regular'; orders: SalesmanDispatchOrder[]; empty: string }) {
  return <section className={`card salesman-order-panel ${tone}`}><div className="salesman-section-head"><h2>{title}</h2><strong>{orders.reduce((sum, order) => sum + order.machineCount, 0)} machines</strong></div><div className="salesman-order-list">{orders.map((order) => <article className="salesman-mini-order" key={order.id}><div><strong>{order.salesOrderNumber}</strong><span>{order.customerName}</span></div><em>{order.machineCount} machines</em>{order.machineLabels.length > 0 && <p>{order.machineLabels.join(' · ')}</p>}</article>)}{!orders.length && <div className="empty-state small"><strong>{empty}</strong></div>}</div></section>
}

function ShipmentPanel({ orders }: { orders: SalesmanShipmentOrder[] }) {
  return <section className="card salesman-order-panel shipment"><div className="salesman-section-head"><h2>Ready to Ship Orders</h2><strong>{orders.reduce((sum, order) => sum + order.machineCount, 0)} machines</strong></div><div className="salesman-order-list">{orders.map((order) => <article className="salesman-mini-order" key={order.id}><div><strong>{order.salesOrderNumber}</strong><span>{order.customerName}</span></div><em>{order.needsBuilty ? 'Builty needed' : `${order.machineCount} machines`}</em>{order.machineLabels.length > 0 && <p>{order.machineLabels.join(' · ')}</p>}</article>)}{!orders.length && <div className="empty-state small"><strong>No shipment workload pending</strong></div>}</div></section>
}
