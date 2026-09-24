import { readLocalJsonFresh, updateLocalJson } from './local-store'
import { fetchZohoPaymentOrderDetail, type ZohoPaymentOrder } from './zoho-payment-orders'
import type { Payment } from './payments'

export type SalesOrderSnapshot={salesOrderId:string;salesOrderNumber:string;customerName:string;orderTotal:number;orderDate:string;rawStatus:string;currency:string;modifiedTime:string;syncedAt:string;version:number;available:boolean;audit:Array<{at:string;source:'zoho';oldTotal?:number;newTotal:number;oldCustomer?:string;newCustomer:string;oldModifiedTime?:string;newModifiedTime:string}>}
type Store={orders:Record<string,SalesOrderSnapshot>}
const FILE='sales-order-snapshots.json',EMPTY:Store={orders:{}}
const norm=(value?:string)=>String(value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'')
export function linkedOrderIds(payments:Payment[]){return [...new Set(payments.map(p=>p.salesOrderId).filter((id):id is string=>Boolean(id)))]}
export function applySalesOrderSnapshots(payments:Payment[],orders:Record<string,SalesOrderSnapshot>){
 const byNumber=new Map(Object.values(orders).map(o=>[norm(o.salesOrderNumber),o]))
 return payments.map(payment=>{const order=(payment.salesOrderId&&orders[payment.salesOrderId])||byNumber.get(norm(payment.salesOrderNumber));return order?.available?{...payment,salesOrderId:order.salesOrderId,salesOrderNumber:order.salesOrderNumber,customerName:order.customerName,orderTotal:order.orderTotal,salesOrderDate:order.orderDate}:payment})
}
export async function readSalesOrderSnapshots(){return(await readLocalJsonFresh(FILE,EMPTY)).orders}
export async function commitSalesOrder(order:ZohoPaymentOrder,at=new Date().toISOString(),baseline?:Pick<Payment,'orderTotal'|'customerName'>){
 let changed=false
 await updateLocalJson(FILE,EMPTY,store=>{const old=store.orders[order.id]
  if(old&&order.modifiedTime&&old.modifiedTime&&order.modifiedTime.localeCompare(old.modifiedTime)<0)return store
  const differs=!old||old.orderTotal!==order.orderTotal||old.customerName!==order.customerName||old.salesOrderNumber!==order.salesOrderNumber||old.modifiedTime!==order.modifiedTime||!old.available
  // Equal Zoho versions are idempotent. Refresh checked time only when their content agrees;
  // a contradictory equal/older response cannot overwrite the canonical projection.
  if(!differs)return{orders:{...store.orders,[order.id]:{...old,syncedAt:at}}}
  if(old&&order.modifiedTime&&old.modifiedTime&&order.modifiedTime===old.modifiedTime)return store
  changed=true;const audit=[...(old?.audit||[]),{at,source:'zoho' as const,oldTotal:old?.orderTotal??baseline?.orderTotal,newTotal:order.orderTotal,oldCustomer:old?.customerName??baseline?.customerName,newCustomer:order.customerName,oldModifiedTime:old?.modifiedTime,newModifiedTime:order.modifiedTime}]
  return{orders:{...store.orders,[order.id]:{salesOrderId:order.id,salesOrderNumber:order.salesOrderNumber,customerName:order.customerName,orderTotal:order.orderTotal,orderDate:order.orderDate,rawStatus:order.rawStatus,currency:order.currency,modifiedTime:order.modifiedTime,syncedAt:at,version:(old?.version||0)+1,available:true,audit}}}
 })
 return changed
}
export async function reconcileSalesOrders(ids:string[],options:{limit?:number;fetcher?:typeof fetch;baselines?:Record<string,Pick<Payment,'orderTotal'|'customerName'>>}={}){
 const unique=[...new Set(ids)].slice(0,options.limit??ids.length),results:Array<{id:string;status:'changed'|'unchanged'|'failed';error?:string}>=[]
 for(let i=0;i<unique.length;i+=6)await Promise.all(unique.slice(i,i+6).map(async id=>{try{const order=await fetchZohoPaymentOrderDetail(id,options.fetcher||fetch,true);results.push({id,status:await commitSalesOrder(order,new Date().toISOString(),options.baselines?.[id])?'changed':'unchanged'})}catch(error){console.error(`Zoho sales-order reconciliation failed for ${id}`,error);results.push({id,status:'failed',error:error instanceof Error?error.message:'Zoho unavailable'})}}))
 return results
}
/** Best-effort bounded refresh for reads. Durable stale snapshots remain usable on outage. */
export async function refreshStaleLinkedOrders(payments:Payment[],max=4){
 const snapshots=await readSalesOrderSnapshots().catch(()=>({} as Record<string,SalesOrderSnapshot>)),cutoff=Date.now()-5*60_000
 const ids=linkedOrderIds(payments).filter(id=>!snapshots[id]||Date.parse(snapshots[id].syncedAt)<cutoff).slice(0,max)
 const baselines=Object.fromEntries(payments.filter(p=>p.salesOrderId).map(p=>[p.salesOrderId!,{orderTotal:p.orderTotal,customerName:p.customerName}]))
 if(ids.length)await reconcileSalesOrders(ids,{limit:max,baselines})
 return readSalesOrderSnapshots().catch(()=>snapshots)
}
