import { readLocalJsonFresh, updateLocalJson } from './local-store'
import { fetchZohoPaymentOrderDetail, type ZohoPaymentOrder } from './zoho-payment-orders'
import type { Payment } from './payments'

export type SalesOrderSnapshot={salesOrderId:string;salesOrderNumber:string;customerName:string;orderTotal:number;orderDate:string;rawStatus:string;currency:string;modifiedTime:string;syncedAt:string;version:number;available:boolean;audit:Array<{at:string;source:'zoho';oldTotal?:number;newTotal:number;oldCustomer?:string;newCustomer:string;oldModifiedTime?:string;newModifiedTime:string}>}
type Store={orders:Record<string,SalesOrderSnapshot>}
const FILE='sales-order-snapshots.json',EMPTY:Store={orders:{}}
const norm=(value?:string)=>String(value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'')
export function linkedOrderIds(payments:Payment[]){return [...new Set(payments.map(p=>p.salesOrderId).filter((id):id is string=>Boolean(id)))]}
/** Select a bounded, oldest-first reconciliation batch. A full sweep every ten
 * minutes can exhaust Zoho's organization-wide daily allowance and block the
 * authoritative detail lookup required when a payment is created. */
export function reconciliationBatch(ids:string[],snapshots:Record<string,SalesOrderSnapshot>,limit=10){
 return [...new Set(ids)].sort((a,b)=>(Date.parse(snapshots[a]?.syncedAt||'')||0)-(Date.parse(snapshots[b]?.syncedAt||'')||0)).slice(0,Math.max(1,limit))
}
export function applySalesOrderSnapshots(payments:Payment[],orders:Record<string,SalesOrderSnapshot>){
 const byNumber=new Map(Object.values(orders).map(o=>[norm(o.salesOrderNumber),o]))
 return payments.map(payment=>{const order=(payment.salesOrderId&&orders[payment.salesOrderId])||byNumber.get(norm(payment.salesOrderNumber));return order?.available?{...payment,salesOrderId:order.salesOrderId,salesOrderNumber:order.salesOrderNumber,customerName:order.customerName,orderTotal:order.orderTotal,salesOrderDate:order.orderDate}:payment})
}
export async function readSalesOrderSnapshots(){return(await readLocalJsonFresh(FILE,EMPTY)).orders}
function sameVersion(old:SalesOrderSnapshot,order:ZohoPaymentOrder){return old.orderTotal===order.orderTotal&&old.customerName===order.customerName&&old.salesOrderNumber===order.salesOrderNumber&&old.modifiedTime===order.modifiedTime&&old.available}
async function commitSalesOrders(items:Array<{order:ZohoPaymentOrder;at:string;baseline?:Pick<Payment,'orderTotal'|'customerName'>}>){
 const changed=new Set<string>()
 await updateLocalJson(FILE,EMPTY,store=>{const orders={...store.orders}
  for(const {order,at,baseline} of items){const old=orders[order.id]
   // Once an ordering token exists, a missing, older, or contradictory equal token
   // cannot replace the canonical snapshot.
   if(old?.modifiedTime&&(!order.modifiedTime||order.modifiedTime.localeCompare(old.modifiedTime)<0))continue
   if(old&&sameVersion(old,order)){orders[order.id]={...old,syncedAt:at};continue}
   if(old?.modifiedTime&&order.modifiedTime===old.modifiedTime)continue
   changed.add(order.id);const audit=[...(old?.audit||[]),{at,source:'zoho' as const,oldTotal:old?.orderTotal??baseline?.orderTotal,newTotal:order.orderTotal,oldCustomer:old?.customerName??baseline?.customerName,newCustomer:order.customerName,oldModifiedTime:old?.modifiedTime,newModifiedTime:order.modifiedTime}]
   orders[order.id]={salesOrderId:order.id,salesOrderNumber:order.salesOrderNumber,customerName:order.customerName,orderTotal:order.orderTotal,orderDate:order.orderDate,rawStatus:order.rawStatus,currency:order.currency,modifiedTime:order.modifiedTime,syncedAt:at,version:(old?.version||0)+1,available:true,audit}
  }
  return{orders}
 })
 return changed
}
export async function commitSalesOrder(order:ZohoPaymentOrder,at=new Date().toISOString(),baseline?:Pick<Payment,'orderTotal'|'customerName'>){return(await commitSalesOrders([{order,at,baseline}])).has(order.id)}
export async function reconcileSalesOrders(ids:string[],options:{limit?:number;fetcher?:typeof fetch;baselines?:Record<string,Pick<Payment,'orderTotal'|'customerName'>>}={}){
 const unique=[...new Set(ids)].slice(0,options.limit??ids.length),fetched:Array<{order:ZohoPaymentOrder;at:string;baseline?:Pick<Payment,'orderTotal'|'customerName'>}>=[],failures=new Map<string,string>()
 for(let i=0;i<unique.length;i+=6)await Promise.all(unique.slice(i,i+6).map(async id=>{try{fetched.push({order:await fetchZohoPaymentOrderDetail(id,options.fetcher||fetch,true),at:new Date().toISOString(),baseline:options.baselines?.[id]})}catch(error){console.error(`Zoho sales-order reconciliation failed for ${id}`,error);failures.set(id,error instanceof Error?error.message:'Zoho unavailable')}}))
 // One optimistic durable write per run prevents a linked-order sweep from timing out
 // after serially rewriting the complete R2 object once per order.
 const changed=fetched.length?await commitSalesOrders(fetched):new Set<string>()
 return unique.map(id=>failures.has(id)?{id,status:'failed' as const,error:failures.get(id)}:{id,status:changed.has(id)?'changed' as const:'unchanged' as const})
}
/** Best-effort bounded refresh for reads. Durable stale snapshots remain usable on outage. */
export async function refreshStaleLinkedOrders(payments:Payment[],max=4){
 const snapshots=await readSalesOrderSnapshots().catch(()=>({} as Record<string,SalesOrderSnapshot>)),cutoff=Date.now()-60*60_000
 const ids=linkedOrderIds(payments).filter(id=>!snapshots[id]||Date.parse(snapshots[id].syncedAt)<cutoff).slice(0,max)
 const baselines=Object.fromEntries(payments.filter(p=>p.salesOrderId).map(p=>[p.salesOrderId!,{orderTotal:p.orderTotal,customerName:p.customerName}]))
 if(ids.length)await reconcileSalesOrders(ids,{limit:max,baselines})
 return readSalesOrderSnapshots().catch(()=>snapshots)
}
