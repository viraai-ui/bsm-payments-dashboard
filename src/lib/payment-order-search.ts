import { readLocalJson, writeLocalJson } from './local-store'
import { normalizePaymentOrderSearch, paymentOrderStatus, rankPaymentOrderSuggestions } from './payment-order-lookup'
import { fetchAllZohoPaymentOrders, fetchZohoPaymentOrderDetail, searchZohoPaymentOrders, type ZohoPaymentOrder } from './zoho-payment-orders'

const FILE = 'payment-order-index.json', FRESH_MS = 60_000
export type PaymentOrderSuggestion = { id:string; salesOrderNumber:string; customerName:string; rawStatus:string; status:'Open'|'Closed'|'Status unknown'; orderDate:string; total:number; orderTotal:number; currency:string }
type StoredOrder = { id:string; salesOrderNumber:string; customerName:string; status:string; orderDate:string; orderTotal:number; currency?:string }
type Snapshot = { version:1; updatedAt:string; orders:StoredOrder[] }
type Cache = { loadedAt:number; updatedAt:string; source:'zoho_live'|'local_fallback'; fallbackReason?:string; orders:PaymentOrderSuggestion[] }
const caches = new Map<string, Cache>(), flights = new Map<string, Promise<Cache>>()

function safe(o: StoredOrder | ZohoPaymentOrder): PaymentOrderSuggestion {
  const rawStatus = 'rawStatus' in o ? o.rawStatus : o.status, orderTotal = Number(o.orderTotal)
  return { ...o, total: 'total' in o ? o.total : orderTotal, orderTotal, currency:o.currency||'INR', rawStatus, status:paymentOrderStatus(rawStatus) }
}
async function fallback(reason?:string):Promise<Cache> {
  const snapshot=await readLocalJson<Snapshot>(FILE,{version:1,updatedAt:'',orders:[]})
  if(!Array.isArray(snapshot.orders)) throw new Error('Local payment order index is malformed')
  return {loadedAt:Date.now(),updatedAt:snapshot.updatedAt,source:'local_fallback',fallbackReason:reason,orders:snapshot.orders.map(safe)}
}
async function load(query='',limit=25,force=false) {
  const key=`${normalizePaymentOrderSearch(query)}:${limit}`, existing=caches.get(key)
  if(!force&&existing&&Date.now()-existing.loadedAt<FRESH_MS)return existing
  const active=flights.get(key);if(active)return active
  const flight=(async()=>{
    if(process.env.APP_LOCAL_ONLY==='true')return fallback('APP_LOCAL_ONLY is enabled')
    try {
      const orders=(await searchZohoPaymentOrders(query,limit)).map(safe)
      return {loadedAt:Date.now(),updatedAt:new Date().toISOString(),source:'zoho_live' as const,orders}
    } catch(error) {
      const reason=error instanceof Error?error.message:'Zoho is unavailable',local=await fallback(reason)
      if(!local.orders.length)throw new Error(`${reason}; no local fallback is available`)
      return local
    }
  })().then(result=>{caches.set(key,result);return result}).finally(()=>flights.delete(key))
  flights.set(key,flight);return flight
}
export async function refreshPaymentOrderIndex(force=false){
  caches.clear()
  void force
  return load('',10,true)
}
export async function searchPaymentOrders(query='',limit=10){
  const started=performance.now(),bounded=Math.max(1,Math.min(limit,50)),current=await load(query,bounded)
  const orders=rankPaymentOrderSuggestions(current.orders,query,bounded)
  return {orders,total:orders.length,updatedAt:current.updatedAt,source:current.source,fallbackReason:current.fallbackReason,stale:current.source==='local_fallback',searchMs:performance.now()-started}
}
/** Explicit/cron refresh: one complete paginated Zoho walk updates the shared durable fallback. */
export async function synchronizePaymentOrderIndex(){
  const orders=(await fetchAllZohoPaymentOrders()).map(safe)
  const snapshot:Snapshot={version:1,updatedAt:new Date().toISOString(),orders:orders.map(({id,salesOrderNumber,customerName,rawStatus,orderDate,orderTotal,currency})=>({id,salesOrderNumber,customerName,status:rawStatus,orderDate,orderTotal,currency}))}
  await writeLocalJson(FILE,snapshot);caches.clear()
  return {updatedAt:snapshot.updatedAt,count:snapshot.orders.length}
}
/** Exact selections are re-read from Zoho detail so settlement never trusts a list snapshot total. */
export async function validatePaymentOrder(id:string,number:string,customer?:string){
  if(process.env.APP_LOCAL_ONLY!=='true'){
    try{const order=safe(await fetchZohoPaymentOrderDetail(id));return order.salesOrderNumber===number&&(!customer||order.customerName===customer)?order:null}catch{/* outage fallback below */}
  }
  const current=await fallback(process.env.APP_LOCAL_ONLY==='true'?'APP_LOCAL_ONLY is enabled':'Zoho detail lookup unavailable')
  return current.orders.find(o=>o.id===id&&o.salesOrderNumber===number&&(!customer||o.customerName===customer))||null
}
export function resetPaymentOrderSearchForTests(){caches.clear();flights.clear()}
