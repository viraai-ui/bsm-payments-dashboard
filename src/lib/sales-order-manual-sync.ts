import { readLocalJsonFresh, updateLocalJson } from './local-store'
import { fetchZohoPaymentOrderDetail, type ZohoPaymentOrder } from './zoho-payment-orders'
import { commitSalesOrder, isCanonicalZohoOrderId } from './sales-order-reconciliation'
import { migrateExactOrderLink, type Payment } from './payments'

const canonical=(v:string)=>String(v||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'')
type Limit={users:Record<string,number[]>;global:number[];inflight:Record<string,{owner:string;expiresAt:string}>}
const EMPTY:Limit={users:{},global:[],inflight:{}}
export class SyncLimitError extends Error{constructor(public status:429|503,public retryAfter:number,message:string){super(message)}}

export function exactIndexedOrderId(number:string,orders:Record<string,{salesOrderNumber?:string}>){const key=canonical(number),ids=Object.entries(orders).filter(([id,o])=>isCanonicalZohoOrderId(id)&&canonical(o.salesOrderNumber||'')===key).map(([id])=>id);return ids.length===1?ids[0]:null}
async function acquire(userId:string,key:string,now=Date.now()){
 let acquired=false,retry=0;const owner=crypto.randomUUID(),minute=now-60_000
 await updateLocalJson('sales-order-sync-limits.json',EMPTY,s=>{const users=Object.fromEntries(Object.entries(s.users||{}).map(([u,x])=>[u,x.filter(t=>t>minute)])),global=(s.global||[]).filter(t=>t>minute),inflight=Object.fromEntries(Object.entries(s.inflight||{}).filter(([,v])=>Date.parse(v.expiresAt)>now));const active=inflight[key]
  if(active){retry=Math.max(1,Math.ceil((Date.parse(active.expiresAt)-now)/1000));return{users,global,inflight}}
  if((users[userId]||[]).length>=3||global.length>=12){retry=60;return{users,global,inflight}}
  users[userId]=[...(users[userId]||[]),now];global.push(now);inflight[key]={owner,expiresAt:new Date(now+30_000).toISOString()};acquired=true;return{users,global,inflight}})
 if(!acquired)throw new SyncLimitError(retry===60?429:503,retry,retry===60?'Sync limit reached. Try again in a minute.':'This sales order is already syncing.')
 return async()=>updateLocalJson('sales-order-sync-limits.json',EMPTY,s=>{if(s.inflight?.[key]?.owner===owner)delete s.inflight[key];return s})
}
export async function syncPaymentSalesOrder(paymentId:string,userId:string){
 const store=await readLocalJsonFresh<{payments:Payment[]}>('payments.json',{payments:[]}),payment=store.payments.find(p=>p.id===paymentId)
 if(!payment||!payment.salesOrderNumber)throw Object.assign(new Error('Linked payment not found'),{status:404})
 const index=await readLocalJsonFresh<{orders:Record<string,{salesOrderNumber?:string}>}>('payment-order-index.json',{orders:{}})
 const id=isCanonicalZohoOrderId(payment.salesOrderId||'')?payment.salesOrderId!:exactIndexedOrderId(payment.salesOrderNumber,index.orders||{})
 if(!id)throw Object.assign(new Error('Exact sales order is not available in the server index'),{status:404})
 const release=await acquire(userId,`${id}:${canonical(payment.salesOrderNumber)}`)
 try{const order=await fetchZohoPaymentOrderDetail(id,fetch,true,true);if(canonical(order.salesOrderNumber)!==canonical(payment.salesOrderNumber))throw Object.assign(new Error('Zoho returned a different sales order'),{status:409})
  const changed=await commitSalesOrder(order,new Date().toISOString(),{orderTotal:payment.orderTotal,customerName:payment.customerName})
  await updateLocalJson<any>('payment-order-index.json',{version:2,updatedAt:'',orders:{},state:{}},s=>{s.orders=s.orders||{};for(const [oldId,o] of Object.entries(s.orders) as Array<[string,{salesOrderNumber?:string}]>)if(oldId!==order.id&&canonical(o.salesOrderNumber||'')===canonical(order.salesOrderNumber))delete s.orders[oldId];s.orders[order.id]={id:order.id,salesOrderNumber:order.salesOrderNumber,customerName:order.customerName,status:order.rawStatus,orderDate:order.orderDate,orderTotal:order.orderTotal,currency:order.currency,modifiedTime:order.modifiedTime};s.updatedAt=new Date().toISOString();return s})
  const relinked=await migrateExactOrderLink(payment.salesOrderId,payment.salesOrderNumber,order,userId)
  return{order,changed:changed||relinked>0,relinked}
 }finally{await release()}
}