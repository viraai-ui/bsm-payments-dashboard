'use client'
import { useCallback,useEffect,useRef,useState } from 'react'
import type { SalespersonOverview } from '@/lib/salesperson-overview'


const money=(value:number,currency='INR')=>new Intl.NumberFormat('en-IN',{style:'currency',currency,maximumFractionDigits:0}).format(value)
const labels={NO_PAYMENT:'Payment not added',PENDING:'Pending / partial',RECEIVED:'Received'} as const
const addPaymentHref=(id:string,number:string)=>`/payments?view=regular&addOrderId=${encodeURIComponent(id)}&addOrderNumber=${encodeURIComponent(number)}`
export function SalespersonOverviewClient(){
 const [data,setData]=useState<SalespersonOverview|null>(null),[error,setError]=useState(''),[syncing,setSyncing]=useState(false),[syncError,setSyncError]=useState(''),[cooling,setCooling]=useState(false)
 const sequence=useRef(0),controller=useRef<AbortController|null>(null),inFlight=useRef<Promise<void>|null>(null),cooldownTimer=useRef<number|null>(null)
 const refresh=useCallback(()=>{if(inFlight.current)return inFlight.current
  const task=(async()=>{const request=++sequence.current,abort=new AbortController();controller.current=abort
   try{const response=await fetch('/api/salesperson/overview',{cache:'no-store',signal:abort.signal,headers:{accept:'application/json'}}),json=await response.json();if(!response.ok||!json.ok)throw new Error(json.error||'Overview unavailable');if(request===sequence.current){setData(json.data);setError('')}}catch(e){if(!abort.signal.aborted&&request===sequence.current)setError(e instanceof Error?e.message:'Overview unavailable')}finally{if(controller.current===abort)controller.current=null}
  })();inFlight.current=task;void task.finally(()=>{if(inFlight.current===task)inFlight.current=null});return task
 },[])
 const sync=useCallback((retry=false)=>{if(inFlight.current||(!retry&&cooling))return inFlight.current||Promise.resolve()
  setSyncing(true);setSyncError('');setCooling(true);if(cooldownTimer.current)clearTimeout(cooldownTimer.current);cooldownTimer.current=window.setTimeout(()=>setCooling(false),10000)
  const task=(async()=>{try{const response=await fetch('/api/salesperson/overview',{method:'POST',cache:'no-store',headers:{accept:'application/json'}}),json=await response.json();if(!response.ok||!json.ok)throw new Error(json.error||'Sync unavailable');setData(json.data.overview);setError('')}catch(e){setSyncError(e instanceof Error?e.message:'Sync unavailable')}finally{setSyncing(false)}})()
  inFlight.current=task;void task.finally(()=>{if(inFlight.current===task)inFlight.current=null});return task
 },[cooling])
 useEffect(()=>{void refresh();const tick=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh()},5000);const visible=()=>{if(document.visibilityState==='visible')void refresh()};window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible);return()=>{clearInterval(tick);controller.current?.abort();if(cooldownTimer.current)clearTimeout(cooldownTimer.current);window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible)}},[refresh])
 const m=data?.metrics,total=m?.total||0,no=((m?.noPayment||0)/Math.max(total,1))*100,pending=((m?.pending||0)/Math.max(total,1))*100
 return <div className="sp-overview">
  <header className="sp-heading"><div><p className="sp-eyebrow">SALES WORKSPACE</p><h1>Overview</h1><p>Sales orders and payment progress, in one place.</p></div></header>
  {error&&<div className="sp-error" role="alert">{error} <button onClick={()=>void refresh()}>Try again</button></div>}
  {!data&&!error&&<div className="sp-loading" aria-live="polite">Loading your sales orders…</div>}
  {data&&<>
   <section className="sp-metrics" aria-label="Sales order summary">
    <article><span>Total sales orders</span><strong>{m!.total}</strong><small>{money(m!.orderValue)}</small></article>
    <article><span>Payment not added</span><strong>{m!.noPayment}</strong><small>Needs follow-up</small></article>
    <article><span>Pending / partial</span><strong>{m!.pending}</strong><small>{money(m!.outstandingValue)} outstanding</small></article>
    <article><span>Received</span><strong>{m!.received}</strong><small>{money(m!.receivedValue)} collected</small></article>
   </section>
   <section className="sp-charts">
    <article className="sp-panel"><div><h2>Payment status</h2><p>All your current sales orders</p></div><div className="sp-donut-wrap"><div className="sp-donut" role="img" aria-label={`${m!.noPayment} without payment, ${m!.pending} pending or partial, ${m!.received} received`} style={{background:`conic-gradient(#fff ${no}%,#f4c95d ${no}% ${no+pending}%,#45a875 ${no+pending}% 100%)`}}><span><strong>{total}</strong><small>orders</small></span></div><ul><li><i className="white"/>Payment not added <b>{m!.noPayment}</b></li><li><i className="yellow"/>Pending / partial <b>{m!.pending}</b></li><li><i className="green"/>Received <b>{m!.received}</b></li></ul></div></article>
    <article className="sp-panel"><div><h2>Collection progress</h2><p>Received against total order value</p></div><div className="sp-progress"><div><span>Received</span><b>{money(m!.receivedValue)}</b></div><progress max={Math.max(m!.orderValue,1)} value={Math.min(m!.receivedValue,m!.orderValue)}/><div><span>Outstanding</span><b>{money(m!.outstandingValue)}</b></div></div></article>
   </section>
   <section className="sp-orders"><header><div><h2>Your sales orders</h2><p>Follow up from top to bottom</p></div><div className="sp-sync-area"><div className="sp-sync-line"><button className="sp-sync-button" onClick={()=>void sync()} disabled={syncing||cooling} type="button" aria-label={syncing?'Syncing sales orders':'Sync sales orders'} aria-describedby="sp-mirror-status"><svg className={syncing?'is-spinning':''} viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.1 9A7 7 0 0 1 18.5 6.5L20 8M4 16l1.5 1.5A7 7 0 0 0 17.9 15"/></svg><span>{syncing?'Syncing…':'Sync'}</span></button><span id="sp-mirror-status" title={data.mirror.lastSyncedAt}>Mirror synced {data.mirror.freshnessSeconds===null?'unknown':`${data.mirror.freshnessSeconds}s ago`}</span></div>{syncError&&<div className="sp-sync-error" role="status" aria-live="polite">{syncError} <button type="button" onClick={()=>void sync(true)}>Retry</button></div>}<span className="sr-only" aria-live="polite">{syncing?'Syncing sales orders':syncError?`Sync failed: ${syncError}`:''}</span></div></header>
    {!data.orders.length?<div className="sp-empty"><strong>No mapped sales orders yet</strong><p>Orders appear after Zoho supplies a salesperson identity matching your account.</p></div>:<div className="sp-table-wrap"><table><thead><tr><th>Sales order</th><th>Date</th><th>Customer / company</th><th>Order total</th><th>Received</th><th>Outstanding</th><th>Status</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{data.orders.map(order=><tr className={`sp-${order.status.toLowerCase()}`} key={order.salesOrderId}><td data-label="Sales order"><strong>{order.salesOrderNumber}</strong></td><td data-label="Date">{order.orderDate||'—'}</td><td data-label="Customer / company">{order.customerName||'—'}</td><td data-label="Order total">{money(order.orderTotal,order.currency)}</td><td data-label="Received">{money(order.received,order.currency)}</td><td data-label="Outstanding">{money(order.outstanding,order.currency)}</td><td data-label="Status"><span className="sp-status">{labels[order.status]}</span></td><td className="sp-order-action">{order.status==='NO_PAYMENT'&&<a href={addPaymentHref(order.salesOrderId,order.salesOrderNumber)} aria-label={`Add payment for ${order.salesOrderNumber}`}>Add Payment</a>}</td></tr>)}</tbody></table></div>}
   </section>
  </>}
 </div>
}
