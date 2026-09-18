import type { Payment } from './payments'
export type ViewerMetric = { label: string; amount: number; count: number }
export function localDateKey(value: string | Date): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}
export function viewerPaymentMetrics(payments: Payment[], now = new Date()): ViewerMetric[] {
  const today = localDateKey(now), monday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const weekStart = localDateKey(monday)
  const summarize = (predicate: (payment: Payment) => boolean) => { const matching=payments.filter(predicate); return {amount:matching.reduce((sum,p)=>sum+p.paymentAmount,0),count:matching.length} }
  const received=(p:Payment)=>p.status==='Payment Received', paymentDay=(p:Payment)=>localDateKey(p.paymentDate||p.createdAt), enteredDay=(p:Payment)=>localDateKey(p.paymentDate||p.createdAt)
  const monthStart=`${today.slice(0,7)}-01`
  return [
    {label:'Payment Received Today',...summarize(p=>p.status!=='Void'&&enteredDay(p)===today)},
    {label:'Pending Payments',...summarize(p=>p.status==='Pending')},
    {label:'Payments Received This Week',...summarize(p=>received(p)&&paymentDay(p)>=weekStart&&paymentDay(p)<=today)},
    {label:'Payments Received This Month',...summarize(p=>received(p)&&paymentDay(p)>=monthStart&&paymentDay(p)<=today)},
  ]
}