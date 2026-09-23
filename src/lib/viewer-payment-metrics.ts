import type { Payment } from './payments'

export type ViewerPeriod = 'day' | 'week' | 'month'
export type ViewerMetric = { label: string; amount: number; count: number }
export type PeriodMetric = { amountPaise: number; count: number; start: Date }
export type ChartBucket = { key: string; label: string; amountPaise: number; count: number; start: Date; end: Date }

export function localDateKey(value: string | Date): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}
const dayStart=(d:Date)=>new Date(d.getFullYear(),d.getMonth(),d.getDate())
const paymentDay=(p:Payment)=>localDateKey(p.paymentDate||p.createdAt)
/** The amount represented by this row. Allocation parents contribute only their remainder;
 * non-void children represent the allocated part, so a receipt is never counted twice. */
export function effectivePaymentPaise(payment: Payment): number {
  const amount = payment.originalPaymentAmount !== undefined && !payment.parentPaymentId
    ? (payment.remainingAmount ?? payment.paymentAmount) : payment.paymentAmount
  const paise=Math.round(amount*100)
  return Number.isSafeInteger(paise)&&paise>0?paise:0
}
export function paymentIsEffective(p:Payment){return p.status!=='Void'&&effectivePaymentPaise(p)>0}

/** Hero metric: every positive effective receipt added in the selected current period. */
export function overviewPaymentsByPeriod(payments:Payment[],period:ViewerPeriod,now=new Date()):PeriodMetric{
  const end=dayStart(now),start=new Date(end)
  if(period==='week')start.setDate(start.getDate()-((start.getDay()+6)%7))
  if(period==='month')start.setDate(1)
  const from=localDateKey(start),to=localDateKey(end),matching=payments.filter(p=>paymentIsEffective(p)&&paymentDay(p)>=from&&paymentDay(p)<=to)
  return {amountPaise:matching.reduce((n,p)=>n+effectivePaymentPaise(p),0),count:matching.length,start}
}
// Backwards-compatible export used by older callers; semantics now match the Overview brief.
export const receivedPaymentsByPeriod=overviewPaymentsByPeriod
export type ReceivedPeriod=ViewerPeriod
export type ReceivedPeriodMetric=PeriodMetric

export function paymentChartBuckets(payments:Payment[],period:ViewerPeriod,kind:'total'|'pending',now=new Date()):ChartBucket[]{
  const today=dayStart(now),defs:{start:Date;end:Date}[]=[]
  if(period==='day') for(let i=29;i>=0;i--){const start=new Date(today);start.setDate(start.getDate()-i);defs.push({start,end:new Date(start)})}
  if(period==='week') {const current=new Date(today);current.setDate(current.getDate()-((current.getDay()+6)%7));for(let i=7;i>=0;i--){const start=new Date(current);start.setDate(start.getDate()-i*7);const end=new Date(start);end.setDate(end.getDate()+6);defs.push({start,end})}}
  if(period==='month') for(let i=11;i>=0;i--){const start=new Date(today.getFullYear(),today.getMonth()-i,1),end=new Date(start.getFullYear(),start.getMonth()+1,0);defs.push({start,end})}
  const fmt=period==='month'?new Intl.DateTimeFormat('en-IN',{month:'short',year:'2-digit'}):new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short'})
  return defs.map(({start,end})=>{const from=localDateKey(start),through=localDateKey(end>today?today:end);const rows=payments.filter(p=>paymentIsEffective(p)&&(kind==='total'||p.status==='Pending')&&paymentDay(p)>=from&&paymentDay(p)<=through);return{key:localDateKey(start),label:period==='week'?`${fmt.format(start)} – ${fmt.format(end>today?today:end)}`:fmt.format(start),amountPaise:rows.reduce((n,p)=>n+effectivePaymentPaise(p),0),count:rows.length,start,end}})
}

export function viewerRegularSummary(payments:Payment[]){
 const regular=payments.filter(p=>paymentIsEffective(p)&&p.status!=='Unauthorised')
 const summarize=(rows:Payment[])=>({amountPaise:rows.reduce((n,p)=>n+effectivePaymentPaise(p),0),count:rows.length})
 return {total:summarize(regular),received:summarize(regular.filter(p=>p.status==='Payment Received')),notConfirmed:summarize(regular.filter(p=>p.status!=='Payment Received'))}
}
export function pendingPeriodSummary(payments:Payment[],now=new Date()){
 const week=overviewPaymentsByPeriod(payments.filter(p=>p.status==='Pending'),'week',now),month=overviewPaymentsByPeriod(payments.filter(p=>p.status==='Pending'),'month',now)
 return {week,month}
}
export function viewerPaymentMetrics(payments: Payment[], now = new Date()): ViewerMetric[] {
 const today=localDateKey(now),monday=dayStart(now);monday.setDate(monday.getDate()-((monday.getDay()+6)%7));const weekStart=localDateKey(monday),monthStart=`${today.slice(0,7)}-01`
 const summarize=(predicate:(p:Payment)=>boolean)=>{const rows=payments.filter(p=>paymentIsEffective(p)&&predicate(p));return{amount:rows.reduce((n,p)=>n+effectivePaymentPaise(p),0)/100,count:rows.length}}
 return [{label:'Payment Received Today',...summarize(p=>paymentDay(p)===today)},{label:'Pending Payments',...summarize(p=>p.status==='Pending')},{label:'Payments Received This Week',...summarize(p=>p.status==='Payment Received'&&paymentDay(p)>=weekStart&&paymentDay(p)<=today)},{label:'Payments Received This Month',...summarize(p=>p.status==='Payment Received'&&paymentDay(p)>=monthStart&&paymentDay(p)<=today)}]
}
