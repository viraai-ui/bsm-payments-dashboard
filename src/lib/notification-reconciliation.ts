import type { PaymentNotification } from './payment-notifications'

export type NotificationSnapshot={notifications:PaymentNotification[];unreadCount:number;scope:string}
export type NotificationState={items:PaymentNotification[];scope:string|null;sequence:number;readIds:Set<string>}
export const emptyNotificationState=():NotificationState=>({items:[],scope:null,sequence:0,readIds:new Set()})

/** Monotonic reconciliation prevents an older/partial poll from removing an event.
 * Scope changes are the sole implicit reset; actual removals happen on a new session
 * or explicit server policy, never because one serverless snapshot was stale. */
export function reconcileNotifications(state:NotificationState,snapshot:NotificationSnapshot,sequence:number):NotificationState{
 if(state.scope!==null&&state.scope!==snapshot.scope)return{items:snapshot.notifications,scope:snapshot.scope,sequence,readIds:new Set()}
 if(sequence<state.sequence)return state
 const byId=new Map(state.items.map(item=>[item.id,item]))
 for(const incoming of snapshot.notifications){
  const prior=byId.get(incoming.id),locallyRead=state.readIds.has(incoming.id)
  byId.set(incoming.id,{...prior,...incoming,readAt:prior?.readAt||incoming.readAt||(locallyRead?new Date(0).toISOString():null)})
 }
 return{...state,scope:snapshot.scope,sequence,items:[...byId.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}
}

export function optimisticallyRead(state:NotificationState,id?:string):NotificationState{
 const readIds=new Set(state.readIds),now=new Date().toISOString()
 const items=state.items.map(item=>{if(id&&item.id!==id)return item;if(!item.readAt){readIds.add(item.id);return{...item,readAt:now}}return item})
 return{...state,items,readIds}
}