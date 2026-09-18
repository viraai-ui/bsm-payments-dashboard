'use client'

import { useEffect, useRef, useState } from 'react'
import type { PaymentNotification } from '@/lib/payment-notifications'

type NotificationResult={notifications:PaymentNotification[];unreadCount:number}
let notificationRequest:Promise<NotificationResult|null>|null=null
function requestNotifications(){
 if(notificationRequest)return notificationRequest
 notificationRequest=fetch('/api/payments/notifications',{cache:'no-store'}).then(async r=>r.ok?(await r.json()).data:null).finally(()=>{notificationRequest=null})
 return notificationRequest
}

export function NotificationCenter(){
 const [items,setItems]=useState<PaymentNotification[]>([]),[unread,setUnread]=useState(0),[open,setOpen]=useState(false)
 const ref=useRef<HTMLDivElement>(null)
 const messageFor=(n:PaymentNotification)=>n.message||`${n.customerName||'Payment'}${n.salesOrderNumber?` · ${n.salesOrderNumber}`:''}${typeof n.paymentAmount==='number'?` · ₹${n.paymentAmount.toLocaleString('en-IN')}`:''}`
 const when=(value:string)=>new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value))
 async function load(){const data=await requestNotifications();if(!data)return;setItems(data.notifications);setUnread(data.unreadCount)}
 useEffect(()=>{void load();const visible=()=>{if(document.visibilityState==='visible')void load()};const timer=setInterval(visible,60000);window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible);return()=>{clearInterval(timer);window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible)}},[])
 useEffect(()=>{if(!open)return;const close=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node))setOpen(false)};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[open])
 async function mark(id?:string){const r=await fetch('/api/payments/notifications',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(id?{id}:{all:true})});if(r.ok){const j=await r.json();setItems(j.data.notifications);setUnread(j.data.unreadCount)}}
 return <div className="notification-center" ref={ref}>
  <button className="notification-bell" type="button" aria-label={`Notifications${unread?`, ${unread} unread`:''}`} aria-expanded={open} onClick={()=>setOpen(v=>!v)}>
   <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>{unread>0&&<span className="notification-count">{unread>99?'99+':unread}</span>}
  </button>
  {open&&<section className="notification-panel" aria-label="Notification center"><header><strong>Notifications</strong>{unread>0&&<button type="button" onClick={()=>void mark()}>Mark all read</button>}</header>
   {items.length===0?<p className="notification-empty">No notifications yet.</p>:<div className="notification-list">{items.map(n=><button type="button" key={n.id} className={n.readAt?'':'unread'} onClick={()=>{if(!n.readAt)void mark(n.id);setOpen(false);if(n.paymentId){if(location.pathname==='/payments')window.dispatchEvent(new CustomEvent('payment:open',{detail:n.paymentId}));else{sessionStorage.setItem('openPaymentId',n.paymentId);location.assign('/payments')}}}}><span>{messageFor(n)}</span><time dateTime={n.createdAt}>{when(n.createdAt)}</time></button>)}</div>}
  </section>}
 </div>
}
