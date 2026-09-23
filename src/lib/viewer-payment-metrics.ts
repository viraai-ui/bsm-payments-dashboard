import type { Payment } from './payments'
export type ViewerMetric = { label: string; amount: number; count: number }
export type ReceivedPeriod = 'day' | 'week' | 'month'
export type ReceivedPeriodMetric = { amountPaise: number; count: number; start: Date }
export function localDateKey(value: string | Date): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}
export function receivedPaymentsByPeriod(payments: Payment[], period: ReceivedPeriod, now = new Date()): ReceivedPeriodMetric {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = new Date(end)
  if (period === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  if (period === 'month') start.setDate(1)
  const startKey = localDateKey(start), endKey = localDateKey(end)
  const matching = payments.filter(payment => {
    if (payment.status !== 'Payment Received') return false
    const key = localDateKey(payment.paymentDate || payment.createdAt)
    return key >= startKey && key <= endKey
  })
  return {
    amountPaise: matching.reduce((sum, payment) => sum + Math.round(payment.paymentAmount * 100), 0),
    count: matching.length,
    start,
  }
}

export function viewerPaymentMetrics(payments: Payment[], now = new Date()): ViewerMetric[] {
  const today = localDateKey(now), monday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const weekStart = localDateKey(monday)
  const accountingAmount=(p:Payment)=>p.originalPaymentAmount!==undefined?(p.remainingAmount??p.paymentAmount):p.paymentAmount
  const summarize = (predicate: (payment: Payment) => boolean) => { const matching=payments.filter(p=>predicate(p)&&accountingAmount(p)>0); return {amount:matching.reduce((sum,p)=>sum+accountingAmount(p),0),count:matching.length} }
  const received=(p:Payment)=>p.status==='Payment Received', paymentDay=(p:Payment)=>localDateKey(p.paymentDate||p.createdAt), enteredDay=(p:Payment)=>localDateKey(p.paymentDate||p.createdAt)
  const monthStart=`${today.slice(0,7)}-01`
  return [
    {label:'Payment Received Today',...summarize(p=>p.status!=='Void'&&enteredDay(p)===today)},
    {label:'Pending Payments',...summarize(p=>p.status==='Pending')},
    {label:'Payments Received This Week',...summarize(p=>received(p)&&paymentDay(p)>=weekStart&&paymentDay(p)<=today)},
    {label:'Payments Received This Month',...summarize(p=>received(p)&&paymentDay(p)>=monthStart&&paymentDay(p)<=today)},
  ]
}