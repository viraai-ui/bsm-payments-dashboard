export type SettlementPayment = {
  id?:string
  customerName:string
  salesOrderNumber?:string
  salesOrderId?:string
  orderTotal?:number
  salesOrderDate?:string
  paymentDate?:string
  paymentAmount:number
  status:'Unauthorised'|'Pending'|'Payment Received'|'Void'
  createdAt?:string
  paymentMode?:string
  remarks?:string
}

const STATUS_ORDER={Pending:0,Unauthorised:1,'Payment Received':2,Void:3} as const
export const toPaise=(amount:number)=>Math.round(amount*100)
export const fromPaise=(paise:number)=>paise/100
const normalizedOrder=(value?:string)=>String(value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'')
const sameOrder=(a?:string,b?:string)=>Boolean(normalizedOrder(a))&&normalizedOrder(a)===normalizedOrder(b)
export function paymentStatusLabel(status:SettlementPayment['status']){return status==='Pending'?'Payment Pending':status==='Void'?'Payment Void':status}
export function sortPayments<T extends SettlementPayment>(payments:T[]){return [...payments].sort((a,b)=>STATUS_ORDER[a.status]-STATUS_ORDER[b.status]||(b.createdAt||'').localeCompare(a.createdAt||'')||(b.id||'').localeCompare(a.id||''))}
export function paymentMatchesSearch(payment:SettlementPayment,query:string,all:SettlementPayment[]){const q=query.trim().toLowerCase();if(!q)return true;const summary=payment.salesOrderNumber?orderSummary(all,payment.salesOrderNumber):undefined;return [payment.customerName,payment.salesOrderNumber,payment.paymentAmount,payment.orderTotal,summary?.orderTotal,summary?.received,summary?.outstanding,payment.paymentMode,payment.remarks,payment.paymentDate,payment.createdAt,paymentStatusLabel(payment.status)].some(v=>String(v??'').toLowerCase().includes(q))}

export function orderSummary(payments:SettlementPayment[], so:string, orderTotal?:number, salesOrderId?:string){
  // Match either immutable Zoho id or normalized SO number. A receipt is visited
  // once by filter even if both identifiers match, preventing double counting.
  const linked=payments.filter(p=>(Boolean(salesOrderId)&&p.salesOrderId===salesOrderId)||sameOrder(p.salesOrderNumber,so))
  const storedTotal=linked.find(p=>p.orderTotal!==undefined)?.orderTotal
  // Explicit orderTotal is authoritative Zoho data; persisted totals are fallback only.
  const total=orderTotal??storedTotal
  const salesOrderDate=linked.find(p=>p.salesOrderDate)?.salesOrderDate
    ?? linked.map(p=>p.paymentDate).filter((date):date is string=>Boolean(date)).sort()[0]
  const confirmedReceivedPaise=linked.filter(p=>p.status==='Payment Received').reduce((n,p)=>n+toPaise(p.paymentAmount),0)
  const submittedAmountPaise=linked.filter(p=>p.status==='Payment Received'||p.status==='Pending').reduce((n,p)=>n+toPaise(p.paymentAmount),0)
  const totalPaise=total===undefined?undefined:toPaise(total)
  const confirmedReceived=fromPaise(confirmedReceivedPaise),submittedAmount=fromPaise(submittedAmountPaise)
  const confirmedOutstanding=totalPaise===undefined?undefined:fromPaise(Math.max(0,totalPaise-confirmedReceivedPaise))
  const provisionalOutstanding=totalPaise===undefined?undefined:fromPaise(Math.max(0,totalPaise-submittedAmountPaise))
  const receivedPercent=total?Math.min(100,Math.round(confirmedReceived/total*100)):0
  return {orderTotal:total,salesOrderDate,advanceReceived:submittedAmount,pendingPayment:provisionalOutstanding,received:confirmedReceived,confirmedReceived,submittedAmount,outstanding:confirmedOutstanding,confirmedOutstanding,provisionalOutstanding,receivedPercent,outstandingPercent:total&&confirmedOutstanding!==undefined?Math.round(confirmedOutstanding/total*100):0,settled:total!==undefined&&total>0&&confirmedOutstanding===0,hasConfirmedReceipt:linked.some(p=>p.status==='Payment Received')}
}

/** Balance immediately after each receipt in accounting order (oldest first).
 * The UI may render newest first; the latest row therefore carries the latest balance.
 * IDs are de-duplicated defensively, while separate receipts always remain separate. */
export function paymentOutstandingById(payments:SettlementPayment[]){
  const result=new Map<string,number|undefined>(),seen=new Set<string>(),received=new Map<string,number>()
  const chronological=[...payments].sort((a,b)=>(a.createdAt||a.paymentDate||'').localeCompare(b.createdAt||b.paymentDate||'')||(a.id||'').localeCompare(b.id||''))
  for(const payment of chronological){
    if(!payment.id||seen.has(payment.id))continue
    seen.add(payment.id)
    const order=payment.salesOrderId?`id:${payment.salesOrderId}`:`so:${normalizedOrder(payment.salesOrderNumber)}`
    if(order==='so:'){result.set(payment.id,undefined);continue}
    const prior=received.get(order)||0
    const cumulative=prior+((payment.status==='Pending'||payment.status==='Payment Received')?toPaise(payment.paymentAmount):0)
    received.set(order,cumulative)
    result.set(payment.id,payment.orderTotal===undefined?undefined:fromPaise(Math.max(0,toPaise(payment.orderTotal)-cumulative)))
  }
  return result
}

export function pendingOrderSummaries(payments:SettlementPayment[]){
  const orders=new Map<string,{salesOrderNumber:string;customerName:string}>()
  for(const payment of payments)if(payment.salesOrderNumber&&payment.orderTotal&&!orders.has(payment.salesOrderNumber))orders.set(payment.salesOrderNumber,{salesOrderNumber:payment.salesOrderNumber,customerName:payment.customerName})
  return [...orders.values()].map(order=>({...order,...orderSummary(payments,order.salesOrderNumber)})).filter(order=>typeof order.orderTotal==='number'&&order.orderTotal>0&&order.hasConfirmedReceipt&&!order.settled).sort((a,b)=>a.salesOrderNumber.localeCompare(b.salesOrderNumber))
}
