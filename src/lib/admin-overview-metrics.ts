import type { Payment } from './payments'
import { soPaymentAmount } from './payment-settlement'
import { localDateKey, type ViewerPeriod } from './viewer-payment-metrics'

export type AdminOverviewBucket={key:string;label:string;amountPaise:number;count:number}
export type AdminOverviewSummary={
 cash:{amountPaise:number;count:number}; pending:{amountPaise:number;count:number}; unauthorised:{amountPaise:number;count:number};
 outstanding:{amountPaise:number;count:number}; expenses:{amountPaise:number;count:number}; buckets:AdminOverviewBucket[];
 composition:Array<{status:string;amountPaise:number;count:number}>;
 salespeople:Array<{name:string;amountPaise:number;count:number}>;
 recent:Array<{id:string;customerName:string;reference:string;date:string;status:string;cashPaise:number;appliedPaise:number;salesperson:string}>;
 startLabel:string
}
const paise=(n:number)=>Math.max(0,Math.round((Number.isFinite(n)?n:0)*100))
const rootReceipt=(p:Payment)=>!p.parentPaymentId&&p.status!=='Void'
const cashPaise=(p:Payment)=>paise(p.originalPaymentAmount??p.paymentAmount)
const appliedPaise=(p:Payment)=>p.salesOrderNumber&&p.status!=='Void'?paise(soPaymentAmount(p)):0
const day=(p:Payment)=>localDateKey(p.paymentReceivedDate||p.paymentDate||p.createdAt)
const dayStart=(d:Date)=>new Date(d.getFullYear(),d.getMonth(),d.getDate())
function periodStart(period:ViewerPeriod,now:Date){const start=dayStart(now);if(period==='week')start.setDate(start.getDate()-((start.getDay()+6)%7));if(period==='month')start.setDate(1);return start}
function bucketDefs(period:ViewerPeriod,now:Date){const today=dayStart(now),defs:{start:Date;end:Date}[]=[];if(period==='day')for(let i=13;i>=0;i--){const start=new Date(today);start.setDate(start.getDate()-i);defs.push({start,end:new Date(start)})}if(period==='week'){const current=periodStart('week',today);for(let i=7;i>=0;i--){const start=new Date(current);start.setDate(start.getDate()-i*7);const end=new Date(start);end.setDate(end.getDate()+6);defs.push({start,end})}}if(period==='month')for(let i=11;i>=0;i--){const start=new Date(today.getFullYear(),today.getMonth()-i,1),end=new Date(start.getFullYear(),start.getMonth()+1,0);defs.push({start,end})}return defs}
export function adminOverviewMetrics(payments:Payment[],pendingOrders:Array<{outstanding?:number}>,period:ViewerPeriod,now=new Date()):AdminOverviewSummary{
 const today=localDateKey(now),start=periodStart(period,now),from=localDateKey(start),roots=payments.filter(rootReceipt)
 const inPeriod=roots.filter(p=>day(p)>=from&&day(p)<=today)
 const sum=(rows:Payment[],amount:(p:Payment)=>number)=>({amountPaise:rows.reduce((n,p)=>n+amount(p),0),count:rows.length})
 const pending=roots.filter(p=>p.status==='Pending'),unauthorised=roots.filter(p=>p.status==='Unauthorised')
 const outstandingValues=pendingOrders.map(o=>paise(o.outstanding||0)).filter(Boolean)
 const fmt=new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short'}),monthFmt=new Intl.DateTimeFormat('en-IN',{month:'short',year:'2-digit'})
 const buckets=bucketDefs(period,now).map(({start,end})=>{const rows=roots.filter(p=>day(p)>=localDateKey(start)&&day(p)<=localDateKey(end>now?now:end));return{key:localDateKey(start),label:period==='month'?monthFmt.format(start):fmt.format(start),...sum(rows,cashPaise)}})
 const statuses=['Payment Received','Pending','Unauthorised'] as const
 const composition=statuses.map(status=>({status,...sum(roots.filter(p=>p.status===status),cashPaise)}))
 const people=new Map<string,{amountPaise:number;count:number}>();for(const p of payments){const amount=appliedPaise(p);if(!amount)continue;const name=p.salespersonName||p.addedBy||'Unassigned',current=people.get(name)||{amountPaise:0,count:0};current.amountPaise+=amount;current.count++;people.set(name,current)}
 return {cash:sum(inPeriod,cashPaise),pending:sum(pending,cashPaise),unauthorised:sum(unauthorised,cashPaise),outstanding:{amountPaise:outstandingValues.reduce((a,b)=>a+b,0),count:outstandingValues.length},expenses:sum(inPeriod.filter(p=>(p.expenseAmount||0)>0),p=>paise(p.expenseAmount||0)),buckets,composition,salespeople:[...people].map(([name,value])=>({name,...value})).sort((a,b)=>b.amountPaise-a.amountPaise).slice(0,6),recent:roots.slice().sort((a,b)=>(b.createdAt||b.paymentDate).localeCompare(a.createdAt||a.paymentDate)).slice(0,6).map(p=>({id:p.id,customerName:p.customerName,reference:p.salesOrderNumber||p.utrReference||p.manualReference||'Unlinked',date:day(p),status:p.status,cashPaise:cashPaise(p),appliedPaise:appliedPaise(p),salesperson:p.salespersonName||p.addedBy||'Unassigned'})),startLabel:period==='day'?'Today':`${fmt.format(start)} – ${fmt.format(now)}`}
}
