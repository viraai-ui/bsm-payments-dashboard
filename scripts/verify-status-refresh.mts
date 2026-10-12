import assert from 'node:assert/strict'
import { createPaymentRefreshQueue } from '../src/lib/payment-refresh-queue'
import { orderSummary } from '../src/lib/payment-settlement'
import { selectSalespersonOverview } from '../src/lib/salesperson-overview'

let releaseStale!:()=>void
const staleBlocked=new Promise<void>(resolve=>{releaseStale=resolve})
const queue=createPaymentRefreshQueue()
const applied:string[]=[]
let mutationVersion=0

// A poll starts before the status mutation and returns a stale Pending snapshot.
const staleVersion=mutationVersion
const stale=queue.request(async()=>{
 await staleBlocked
 if(staleVersion===mutationVersion)applied.push('stale-pending')
})

// PATCH commits Payment Received. Its follow-up refresh arrives while the stale
// poll is still active, so it must be queued rather than silently discarded.
mutationVersion+=1
const fresh=queue.request(async()=>{applied.push('fresh-received')})
releaseStale()
await Promise.all([stale,fresh])
assert.deepEqual(applied,['fresh-received'],'delayed stale poll was ignored and a post-mutation refresh ran')

const base={customerName:'Fixture',salesOrderId:'so-1',salesOrderNumber:'SO-1',orderTotal:100,paymentDate:'2026-10-12',createdBy:'sales',createdAt:'2026-10-12T00:00:00Z',updatedAt:'2026-10-12T00:00:00Z'}
const pending={...base,id:'pending',paymentAmount:40,status:'Pending' as const}
const received={...base,id:'received',paymentAmount:60,status:'Payment Received' as const}
const partial=orderSummary([pending,received],'SO-1',100,'so-1')
assert.equal(partial.provisionalOutstanding,0,'Pending and Received receipts both reserve order outstanding')
assert.equal(partial.confirmedOutstanding,40,'Pending receipt does not falsely settle the order')
const settled=orderSummary([{...pending,status:'Payment Received' as const},received],'SO-1',100,'so-1')
assert.equal(settled.settled,true)
assert.equal(settled.confirmedOutstanding,0,'fully received order leaves Pending Payments membership')

// The salesperson Overview returns one canonical DTO: its card counts/value and
// list status are derived in the same selector invocation from the same snapshot.
const user={id:'sales',name:'Sales',email:'sales@example.com',username:'sales',role:'Salesperson' as const,active:true,createdAt:'',updatedAt:''}
const order={id:'so-1',salesOrderNumber:'SO-1',customerName:'Fixture',orderTotal:100,orderDate:'2026-10-01',currency:'INR',salespersonId:'sales',salespersonName:'Sales',salespersonEmail:'sales@example.com',lastSyncedAt:'2026-10-12T00:00:00Z'}
const overview=selectSalespersonOverview([order],[{...pending,status:'Payment Received' as const},received],user,{lastSyncedAt:'2026-10-12T00:00:00Z',recencyVerifiedAt:'2026-10-12T00:00:00Z'},new Date('2026-10-12T00:00:01Z'))
assert.equal(overview.orders[0]?.status,'RECEIVED')
assert.equal(overview.metrics.received,overview.orders.filter(row=>row.status==='RECEIVED').length)
assert.equal(overview.metrics.receivedValue,overview.orders.reduce((sum,row)=>sum+row.received,0))

console.log('PASS status refresh: stale delayed poll rejected, post-mutation refresh guaranteed, pending/received reservation semantics preserved')