'use client'

import {useId, useMemo, useState} from 'react'
import type {Payment} from '@/lib/payments'
import {adminOverviewMetrics} from '@/lib/admin-overview-metrics'
import type {ViewerPeriod} from '@/lib/viewer-payment-metrics'
import './admin-overview.css'

const money = (paise: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
}).format(paise / 100)

const periods: ViewerPeriod[] = ['day', 'week', 'month']

export function AdminOverviewClient({payments, pendingOrders}: {
  payments: Payment[]
  pendingOrders: Array<{outstanding?: number}>
}) {
  const [period, setPeriod] = useState<ViewerPeriod>('month')
  const metrics = useMemo(
    () => adminOverviewMetrics(payments, pendingOrders, period),
    [payments, pendingOrders, period],
  )

  return <section className="admin-overview" data-admin-overview>
    <header className="admin-overview-head">
      <h1>Overview</h1>
      <div className="admin-period" role="group" aria-label="Overview period">
        {periods.map(item => <button
          key={item}
          type="button"
          aria-pressed={period === item}
          onClick={() => setPeriod(item)}
        >{item[0].toUpperCase() + item.slice(1)}</button>)}
      </div>
    </header>

    <div className="admin-hero-grid">
      <article className="admin-cash-card">
        <span>Total received · {metrics.startLabel}</span>
        <strong>{money(metrics.cash.amountPaise)}</strong>
        <p>{metrics.cash.count} {metrics.cash.count === 1 ? 'receipt' : 'receipts'}</p>
      </article>
      <Metric title="Pending receipt" amount={metrics.pending.amountPaise} count={metrics.pending.count} tone="amber" />
      <Metric title="Unauthorised" amount={metrics.unauthorised.amountPaise} count={metrics.unauthorised.count} tone="red" />
      <Metric title="Order outstanding" amount={metrics.outstanding.amountPaise} count={metrics.outstanding.count} tone="navy" />
    </div>

    <div className="admin-analysis-grid">
      <Trend metrics={metrics} />
      <Donut rows={metrics.composition} />
    </div>

    <div className="admin-lower-grid">
      <article className="admin-panel">
        <header><h2>Salesperson credited</h2></header>
        <div className="admin-sales-list">
          {metrics.salespeople.length
            ? metrics.salespeople.map((item, index) => <div key={item.name}>
                <b>{index + 1}</b>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.count} {item.count === 1 ? 'payment' : 'payments'}</small>
                </span>
                <em>{money(item.amountPaise)}</em>
              </div>)
            : <p className="admin-empty">No collections</p>}
        </div>
      </article>

      <article className="admin-panel admin-recent">
        <header>
          <h2>Recent receipts</h2>
          <a href="/payments">View all →</a>
        </header>
        <div className="admin-recent-list">
          {metrics.recent.map(item => <div key={item.id}>
            <span>
              <strong>{item.customerName}</strong>
              <small>{item.reference} · {item.salesperson}</small>
            </span>
            <span>
              <strong>{money(item.cashPaise)}</strong>
              <small>{item.status} · {item.date}</small>
            </span>
          </div>)}
        </div>
      </article>
    </div>
  </section>
}

function Metric({title, amount, count, tone}: {
  title: string
  amount: number
  count: number
  tone: string
}) {
  return <article className={`admin-metric ${tone}`}>
    <span>{title}</span>
    <strong>{money(amount)}</strong>
    <p>{count} {count === 1 ? 'receipt' : 'receipts'}</p>
  </article>
}

function Trend({metrics}: {metrics: ReturnType<typeof adminOverviewMetrics>}) {
  const id = useId()
  const width = 720
  const height = 230
  const padding = 26
  const max = Math.max(1, ...metrics.buckets.map(item => item.amountPaise))
  const points = metrics.buckets.map((bucket, index) => ({
    bucket,
    x: padding + index * (width - padding * 2) / Math.max(1, metrics.buckets.length - 1),
    y: height - padding - bucket.amountPaise / max * (height - padding * 2),
  }))
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join(' ')

  return <article className="admin-panel admin-trend">
    <header>
      <h2>Receipt trend</h2>
      <strong>{money(metrics.buckets.reduce((sum, bucket) => sum + bucket.amountPaise, 0))}</strong>
    </header>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-desc`}>
      <title id={`${id}-title`}>Organisation receipt trend</title>
      <desc id={`${id}-desc`}>Full bank receipt values over time.</desc>
      {[.25, .5, .75, 1].map(value => <line
        key={value}
        x1={padding}
        x2={width - padding}
        y1={height - padding - value * (height - padding * 2)}
        y2={height - padding - value * (height - padding * 2)}
      />)}
      <path className="admin-area" d={`${path} L${width - padding} ${height - padding} L${padding} ${height - padding}Z`} />
      <path className="admin-line" d={path} />
      {points.map(point => <circle key={point.bucket.key} cx={point.x} cy={point.y} r="4">
        <title>{point.bucket.label}: {money(point.bucket.amountPaise)}, {point.bucket.count} receipts</title>
      </circle>)}
    </svg>
    <div className="admin-axis">
      <span>{metrics.buckets[0]?.label}</span>
      <span>{metrics.buckets.at(-1)?.label}</span>
    </div>
  </article>
}

function Donut({rows}: {rows: Array<{status: string; amountPaise: number; count: number}>}) {
  const total = rows.reduce((sum, item) => sum + item.amountPaise, 0)
  const colors = ['#15803d', '#d97706', '#c8102e']
  const parts = rows.map((item, index) => {
    const start = rows.slice(0, index).reduce((sum, row) => sum + row.amountPaise, 0) / Math.max(1, total) * 100
    const end = rows.slice(0, index + 1).reduce((sum, row) => sum + row.amountPaise, 0) / Math.max(1, total) * 100
    return `${colors[index]} ${start}% ${end}%`
  }).join(',')

  return <article className="admin-panel admin-composition">
    <header><h2>Receipt status</h2></header>
    <div
      className="admin-donut"
      role="img"
      aria-label={rows.map(item => `${item.status}: ${money(item.amountPaise)}`).join(', ')}
      style={{background: `conic-gradient(${parts || '#e2e8f0 0 100%'})`}}
    >
      <div>
        <strong>{rows.reduce((sum, item) => sum + item.count, 0)}</strong>
        <span>receipts</span>
      </div>
    </div>
    <div className="admin-legend">
      {rows.map((item, index) => <div key={item.status}>
        <i style={{background: colors[index]}} />
        <span>{item.status}</span>
        <strong>{money(item.amountPaise)}</strong>
      </div>)}
    </div>
  </article>
}
