import { isSalesRole, type SafeUser } from './auth'
import type { Payment } from './payments'
import type { StoredPaymentOrder } from './payment-order-search'
import { orderSummary } from './payment-settlement'

export type OverviewStatus='NO_PAYMENT'|'PENDING'|'RECEIVED'
export type OverviewOrder={salesOrderId:string;salesOrderNumber:string;orderDate:string;customerName:string;currency:string;orderTotal:number;received:number;outstanding:number;status:OverviewStatus}
export type SalespersonOverview={orders:OverviewOrder[];metrics:{total:number;noPayment:number;pending:number;received:number;orderValue:number;receivedValue:number;outstandingValue:number};mirror:{lastSyncedAt:string;recencyVerifiedAt:string;freshnessSeconds:number|null};generatedAt:string}
const norm=(value?:string)=>String(value||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'')
// Exact, reviewed Zoho salesperson labels for accounts whose dashboard display
// name differs. Never use substring/fuzzy matching for ownership.
const ERP_OWNER_ALIASES:Record<string,string[]>= {
 'u-sales2':['Ram Kumar'],
 'u-sales3':['Deepak Kumar'],
 // Confirmed from the authoritative Zoho order detail (salesperson id
 // 1154219000034127315) and the active dashboard account identity.
 'u-eb86002f-067d-4642-83c4-4c35a102cc30':['Manisha Gautam'],
}
const hasErpOwner=(order:StoredPaymentOrder)=>[order.salespersonId,order.salespersonEmail,order.salespersonName].some(value=>Boolean(norm(value)))
export const salespersonOwnsOrder=(order:StoredPaymentOrder,user:SafeUser)=>{
 const aliases=new Set([user.id,user.email,user.name,user.username,...(ERP_OWNER_ALIASES[user.id]||[])].map(norm).filter(Boolean))
 return [order.salespersonId,order.salespersonEmail,order.salespersonName].some(value=>aliases.has(norm(value)))
}
const paymentOwned=(payment:Payment,user:SafeUser)=>payment.ownerUserId===user.id||payment.claimedBy===user.id||[payment.addedBy,payment.salespersonName].some(value=>[user.name,user.email,user.username].map(norm).includes(norm(value)))
const paymentMatchesOrder=(payment:Payment,order:StoredPaymentOrder,numberCounts:Map<string,number>)=>{
 if(payment.salesOrderId)return payment.salesOrderId===order.id
 const number=norm(payment.salesOrderNumber)
 return Boolean(number)&&number===norm(order.salesOrderNumber)&&numberCounts.get(number)===1
}
export function selectSalespersonOverview(orders:StoredPaymentOrder[],payments:Payment[],user:SafeUser,mirror:{lastSyncedAt:string;recencyVerifiedAt:string},now=new Date()):SalespersonOverview{
 if(!isSalesRole(user.role))throw new Error('Salesperson access required')
 const numberCounts=new Map<string,number>();for(const order of orders){const number=norm(order.salesOrderNumber);numberCounts.set(number,(numberCounts.get(number)||0)+1)}
 const owned=orders.filter(order=>salespersonOwnsOrder(order,user)||(!hasErpOwner(order)&&payments.some(payment=>paymentMatchesOrder(payment,order,numberCounts)&&paymentOwned(payment,user))))
 const rank:Record<OverviewStatus,number>={NO_PAYMENT:0,PENDING:1,RECEIVED:2}
 const rows=owned.map(order=>{
  const linked=payments.filter(payment=>paymentMatchesOrder(payment,order,numberCounts))
  const summary=orderSummary(linked,order.salesOrderNumber,order.orderTotal,order.id)
  const qualifying=linked.some(payment=>payment.status==='Pending'||payment.status==='Payment Received')
  const status:OverviewStatus=order.orderTotal<=0||summary.settled?'RECEIVED':qualifying?'PENDING':'NO_PAYMENT'
  return{salesOrderId:order.id,salesOrderNumber:order.salesOrderNumber,orderDate:order.orderDate,customerName:order.customerName,currency:order.currency||'INR',orderTotal:order.orderTotal,received:summary.received,outstanding:summary.outstanding??Math.max(0,order.orderTotal),status}
 }).sort((a,b)=>rank[a.status]-rank[b.status]||b.orderDate.localeCompare(a.orderDate)||b.salesOrderId.localeCompare(a.salesOrderId))
 const metrics={total:rows.length,noPayment:rows.filter(x=>x.status==='NO_PAYMENT').length,pending:rows.filter(x=>x.status==='PENDING').length,received:rows.filter(x=>x.status==='RECEIVED').length,orderValue:rows.reduce((n,x)=>n+x.orderTotal,0),receivedValue:rows.reduce((n,x)=>n+x.received,0),outstandingValue:rows.reduce((n,x)=>n+x.outstanding,0)}
 const parsed=Date.parse(mirror.lastSyncedAt)
 return{orders:rows,metrics,mirror:{...mirror,freshnessSeconds:Number.isFinite(parsed)?Math.max(0,Math.round((now.getTime()-parsed)/1000)):null},generatedAt:now.toISOString()}
}
