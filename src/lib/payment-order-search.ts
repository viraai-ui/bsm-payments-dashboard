import { readLocalJson, readLocalJsonFresh, updateLocalJson } from './local-store'
import { normalizePaymentOrderSearch, paymentOrderStatus, rankPaymentOrderSuggestions } from './payment-order-lookup'
import { fetchZohoPaymentOrderDetail, fetchZohoPaymentOrderPage, type ZohoPaymentOrder } from './zoho-payment-orders'
import { zohoCircuitStatus } from './zoho-circuit'

const FILE='payment-order-index.json',PER_PAGE=200,LEASE_MS=4*60_000,DELTA_OVERLAP_MS=5*60_000
export type PaymentOrderSuggestion={id:string;salesOrderNumber:string;customerName:string;rawStatus:string;status:'Open'|'Closed'|'Status unknown';orderDate:string;total:number;orderTotal:number;currency:string;modifiedTime:string}
type StoredOrder={id:string;salesOrderNumber:string;customerName:string;status:string;orderDate:string;orderTotal:number;currency:string;modifiedTime:string}
type State={schema:2;mode:'backfill'|'delta'|'ready'|'backoff';nextPage:number;perPage:200;startedAt:string;completedAt:string;highWatermark:string;lastSuccessfulSync:string;nextEligibleAt:string;failureClass:string;failureCount:number;pagesProcessed:number;rowsSeen:number;lease?:{id:string;expiresAt:string};deltaSince?:string;deltaMax?:string}
type Snapshot={version:2;updatedAt:string;orders:Record<string,StoredOrder>;state:State}
type Legacy={version:1;updatedAt:string;orders:Array<Omit<StoredOrder,'currency'|'modifiedTime'>>}
const state=():State=>({schema:2,mode:'backfill',nextPage:1,perPage:200,startedAt:'',completedAt:'',highWatermark:'',lastSuccessfulSync:'',nextEligibleAt:'',failureClass:'',failureCount:0,pagesProcessed:0,rowsSeen:0})
const empty=():Snapshot=>({version:2,updatedAt:'',orders:{},state:state()})
function migrate(value:Snapshot|Legacy|unknown):Snapshot{
 const v=(value||{}) as {version?:number;updatedAt?:string;orders?:unknown;state?:State}
 if(v.version===2&&v.orders&&!Array.isArray(v.orders)&&v.state)return{version:2,updatedAt:v.updatedAt||'',orders:v.orders as Record<string,StoredOrder>,state:v.state}
 const out=empty(),legacy=Array.isArray(v.orders)?v.orders as Legacy['orders']:[]
 for(const o of legacy){if(!o?.id)continue;out.orders[o.id]={...o,currency:(o as StoredOrder).currency||'INR',modifiedTime:(o as StoredOrder).modifiedTime||v.updatedAt||''}}
 out.updatedAt=v.updatedAt||'';return out
}
function safe(o:StoredOrder|ZohoPaymentOrder):PaymentOrderSuggestion{const rawStatus='rawStatus'in o?o.rawStatus:o.status,orderTotal=Number(o.orderTotal);return{id:o.id,salesOrderNumber:o.salesOrderNumber,customerName:o.customerName,rawStatus,status:paymentOrderStatus(rawStatus),orderDate:o.orderDate,total:orderTotal,orderTotal,currency:o.currency||'INR',modifiedTime:o.modifiedTime||''}}
function stored(o:{id:string;salesOrderNumber:string;customerName:string;rawStatus:string;orderDate:string;orderTotal?:number;total?:number;currency:string;modifiedTime:string}):StoredOrder|null{const total=Number(o.orderTotal??o.total);return Number.isFinite(total)?{id:o.id,salesOrderNumber:o.salesOrderNumber,customerName:o.customerName,status:o.rawStatus,orderDate:o.orderDate,orderTotal:total,currency:o.currency||'INR',modifiedTime:o.modifiedTime||''}:null}
function newer(old:StoredOrder|undefined,next:StoredOrder){if(!old)return true;const a=Date.parse(old.modifiedTime)||0,b=Date.parse(next.modifiedTime)||0;return b>a||(b===a&&JSON.stringify(old)!==JSON.stringify(next))}
async function snapshot(fresh=false){return migrate(await(fresh?readLocalJsonFresh:readLocalJson)(FILE,empty()))}
export async function searchPaymentOrders(query='',limit=10){
 const started=performance.now(),s=await snapshot(),all=Object.values(s.orders).map(safe),bounded=Math.max(1,Math.min(limit,50)),orders=rankPaymentOrderSuggestions(all,query,bounded)
 const age=s.state.lastSuccessfulSync?Date.now()-Date.parse(s.state.lastSuccessfulSync):Infinity
 return{orders,total:orders.length,updatedAt:s.updatedAt,source:'local_index' as const,stale:age>30*60_000,complete:Boolean(s.state.completedAt),lastSyncedAt:s.state.lastSuccessfulSync||s.updatedAt,searchMs:performance.now()-started}
}
export async function refreshPaymentOrderIndex(_force=false){return searchPaymentOrders('',10)}
async function seedKnown(){
 let seeds:StoredOrder[]=[]
 try{const x=await readLocalJsonFresh<{orders:Record<string,{salesOrderId:string;salesOrderNumber:string;customerName:string;orderTotal:number;orderDate:string;rawStatus:string;currency:string;modifiedTime:string}>}>('sales-order-snapshots.json',{orders:{}});seeds=Object.values(x.orders||{}).map(o=>stored({id:o.salesOrderId,...o})!).filter(Boolean)}catch{}
 if(!seeds.length)return
 await updateLocalJson<Snapshot|Legacy>(FILE,empty(),raw=>{const s=migrate(raw);for(const o of seeds)if(newer(s.orders[o.id],o))s.orders[o.id]=o;return s})
}
export async function synchronizePaymentOrderIndex(options:{maxPages?:number;maxMs?:number;fetcher?:typeof fetch}={}){
 await seedKnown();const leaseId=crypto.randomUUID(),now=Date.now(),maxPages=Math.max(1,Math.min(options.maxPages||5,10)),maxMs=Math.min(options.maxMs||240_000,250_000)
 let acquired=false
 await updateLocalJson<Snapshot|Legacy>(FILE,empty(),raw=>{const s=migrate(raw);if(s.state.lease&&Date.parse(s.state.lease.expiresAt)>now)return s;s.state.lease={id:leaseId,expiresAt:new Date(now+LEASE_MS).toISOString()};if(!s.state.startedAt)s.state.startedAt=new Date(now).toISOString();acquired=true;return s})
 if(!acquired){const s=await snapshot(true);return report(s,0,'lease-active')}
 let calls=0,error=''
 try{
  let s=await snapshot(true);const circuit=await zohoCircuitStatus()
  if(circuit.nextEligibleAt&&Date.parse(circuit.nextEligibleAt)>Date.now()){await markBackoff(leaseId,circuit);return report(await snapshot(true),0,'backoff')}
  const isBackfill=!s.state.completedAt
  let page=isBackfill?s.state.nextPage:(s.state.mode==='delta'&&s.state.deltaSince?s.state.nextPage:1)
  let deltaSince=s.state.deltaSince
  if(!isBackfill&&!deltaSince){const base=Date.parse(s.state.highWatermark||s.state.lastSuccessfulSync||new Date().toISOString());deltaSince=new Date(base-DELTA_OVERLAP_MS).toISOString()}
  for(let i=0;i<maxPages&&Date.now()-now<maxMs;i++){
   calls++;const result=await fetchZohoPaymentOrderPage(page,{modifiedSince:isBackfill?undefined:deltaSince,fetcher:options.fetcher})
   const at=new Date().toISOString()
   await updateLocalJson<Snapshot|Legacy>(FILE,empty(),raw=>{const x=migrate(raw);if(x.state.lease?.id!==leaseId)return x;let max=x.state.deltaMax||x.state.highWatermark
    for(const item of result.orders){const o=stored(item);if(!o)continue;if(newer(x.orders[o.id],o))x.orders[o.id]=o;if(o.modifiedTime&&(!max||Date.parse(o.modifiedTime)>Date.parse(max)))max=o.modifiedTime}
    x.updatedAt=at;x.state.rowsSeen+=result.orders.length;x.state.pagesProcessed++;x.state.failureClass='';x.state.failureCount=0;x.state.nextEligibleAt=''
    if(isBackfill){if(result.hasMore)x.state.nextPage=page+1;else{x.state.completedAt=at;x.state.mode='ready';x.state.nextPage=1;x.state.highWatermark=max||at;x.state.lastSuccessfulSync=at}}
    else if(result.hasMore){x.state.mode='delta';x.state.deltaSince=deltaSince;x.state.deltaMax=max;x.state.nextPage=page+1}else{x.state.mode='ready';x.state.nextPage=1;x.state.highWatermark=max||x.state.highWatermark;x.state.lastSuccessfulSync=at;delete x.state.deltaSince;delete x.state.deltaMax}
    return x})
   page++;if(!result.hasMore)break
  }
 }catch(e){error=e instanceof Error?e.message:'Zoho synchronization failed';const c=await zohoCircuitStatus();await markBackoff(leaseId,c,error)}finally{await updateLocalJson<Snapshot|Legacy>(FILE,empty(),raw=>{const s=migrate(raw);if(s.state.lease?.id===leaseId)delete s.state.lease;return s})}
 return report(await snapshot(true),calls,error)
}
async function markBackoff(id:string,c:{failureClass:string;failureCount:number;nextEligibleAt:string},message=''){await updateLocalJson<Snapshot|Legacy>(FILE,empty(),raw=>{const s=migrate(raw);if(s.state.lease?.id!==id)return s;s.state.mode='backoff';s.state.failureClass=c.failureClass||'request';s.state.failureCount=c.failureCount||1;s.state.nextEligibleAt=c.nextEligibleAt;s.updatedAt=new Date().toISOString();void message;return s})}
function report(s:Snapshot,calls:number,error=''){return{indexedCount:Object.keys(s.orders).length,mode:s.state.mode,page:s.state.nextPage,perPage:s.state.perPage,pagesProcessed:s.state.pagesProcessed,rowsSeen:s.state.rowsSeen,complete:Boolean(s.state.completedAt),lastSyncedAt:s.state.lastSuccessfulSync,watermark:s.state.highWatermark,callsThisRun:calls,nextEligibleAt:s.state.nextEligibleAt,error:error||undefined}}
/** A chosen order must be authoritatively re-read. Never accept a stale total during an outage. */
export async function validatePaymentOrder(id:string,number:string,customer?:string){const order=safe(await fetchZohoPaymentOrderDetail(id));return order.salesOrderNumber===number&&(!customer||order.customerName===customer)?order:null}
export function resetPaymentOrderSearchForTests(){}
