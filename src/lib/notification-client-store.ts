'use client'

import { emptyNotificationState, optimisticallyRead, reconcileNotifications, type NotificationSnapshot, type NotificationState } from './notification-reconciliation'

let state=emptyNotificationState(),requestSequence=0
const listeners=new Set<()=>void>()
const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('bsm-payment-notifications-v1')
const emit=()=>listeners.forEach(listener=>listener())
const accept=(snapshot:NotificationSnapshot,sequence:number)=>{state=reconcileNotifications(state,snapshot,sequence);emit()}
channel?.addEventListener('message',event=>{const snapshot=event.data as NotificationSnapshot;if(snapshot?.scope&&Array.isArray(snapshot.notifications))accept(snapshot,++requestSequence)})

export const notificationClientStore={
 subscribe(listener:()=>void){listeners.add(listener);return()=>listeners.delete(listener)},
 getSnapshot(){return state},
 async load(){
  const sequence=++requestSequence
  const response=await fetch('/api/payments/notifications',{cache:'no-store'})
  if(!response.ok)return
  const snapshot=(await response.json()).data as NotificationSnapshot
  accept(snapshot,sequence);channel?.postMessage(snapshot)
 },
 async mark(id?:string){
  state=optimisticallyRead(state,id);emit()
  const response=await fetch('/api/payments/notifications',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(id?{id}:{all:true})})
  if(response.ok){const snapshot=(await response.json()).data as NotificationSnapshot;accept(snapshot,++requestSequence);channel?.postMessage(snapshot)}
 },
 resetForTests(){state=emptyNotificationState();requestSequence=0;emit()}
}

export function notificationUnread(current:NotificationState){return current.items.filter(item=>!item.readAt).length}
