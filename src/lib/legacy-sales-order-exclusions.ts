import { isSalesRole, type SafeUser } from './auth'
import { readLocalJson, readLocalJsonFresh, updateLocalJson } from './local-store'
import type { Payment } from './payments'
import type { StoredPaymentOrder } from './payment-order-search'
import { orderSummary } from './payment-settlement'
import { salespersonOwnsOrder } from './salesperson-overview'

const FILE='legacy-sales-order-exclusions.json'
export const LEGACY_ALREADY_RECEIVED_FLAG='LEGACY_ALREADY_RECEIVED_ENABLED'
export type LegacySalesOrderExclusion={
 salesOrderNumber:string
 canonicalSalesOrderNumber:string
 salesOrderId:string
 actorUserId:string
 actorName:string
 markedAt:string
 originalOwnerUserId:string
 snapshot?:{customerName:string;orderDate:string;currency:string;orderTotal:number;erpSalespersonId?:string;erpSalespersonName?:string}
}
type Store={exclusions:LegacySalesOrderExclusion[]}
const EMPTY:Store={exclusions:[]}
export const canonicalSalesOrderNumber=(value:string)=>String(value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'')
export const legacyAlreadyReceivedEnabled=()=>process.env[LEGACY_ALREADY_RECEIVED_FLAG]?.trim().toLowerCase()!=='false'
export async function listLegacySalesOrderExclusions(fresh=false){return (fresh?await readLocalJsonFresh(FILE,EMPTY):await readLocalJson(FILE,EMPTY)).exclusions}
export const isLegacySalesOrderExcluded=(order:Pick<StoredPaymentOrder,'id'|'salesOrderNumber'>,userId:string,items:LegacySalesOrderExclusion[])=>items.some(item=>item.originalOwnerUserId===userId&&(item.salesOrderId===order.id||item.canonicalSalesOrderNumber===canonicalSalesOrderNumber(order.salesOrderNumber)))

export async function markLegacySalesOrderAlreadyReceived(order:StoredPaymentOrder,payments:Payment[],user:SafeUser,now=new Date()){
 if(!legacyAlreadyReceivedEnabled())throw Object.assign(new Error('Legacy cleanup is disabled'),{status:403})
 if(!isSalesRole(user.role))throw Object.assign(new Error('Salesperson access required'),{status:403})
 if(!salespersonOwnsOrder(order,user))throw Object.assign(new Error('You can only mark your own sales orders'),{status:403})
 const linked=payments.filter(payment=>payment.salesOrderId===order.id||(!payment.salesOrderId&&canonicalSalesOrderNumber(payment.salesOrderNumber||'')===canonicalSalesOrderNumber(order.salesOrderNumber)))
 if(order.orderTotal<=0||orderSummary(linked,order.salesOrderNumber,order.orderTotal,order.id).settled)throw Object.assign(new Error('Only pending sales orders can be marked'),{status:409})
 const canonical=canonicalSalesOrderNumber(order.salesOrderNumber)
 if(!canonical)throw Object.assign(new Error('Sales order number is required'),{status:400})
 let marker!:LegacySalesOrderExclusion,created=false
 await updateLocalJson(FILE,EMPTY,store=>{
  const existing=store.exclusions.find(item=>item.originalOwnerUserId===user.id&&(item.salesOrderId===order.id||item.canonicalSalesOrderNumber===canonical))
  if(existing){marker=existing;return store}
  created=true;marker={salesOrderNumber:order.salesOrderNumber,canonicalSalesOrderNumber:canonical,salesOrderId:order.id,actorUserId:user.id,actorName:user.name,markedAt:now.toISOString(),originalOwnerUserId:user.id,snapshot:{customerName:order.customerName,orderDate:order.orderDate,currency:order.currency||'INR',orderTotal:order.orderTotal,erpSalespersonId:order.salespersonId,erpSalespersonName:order.salespersonName}}
  return{exclusions:[...store.exclusions,marker]}
 })
 return{marker,created}
}
