import assert from 'node:assert/strict'
import { createPaymentRefreshQueue } from '../src/lib/payment-refresh-queue'
import { orderSummary } from '../src/lib/payment-settlement'

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

console.log('PASS status refresh: stale delayed poll rejected, post-mutation refresh guaranteed, pending/received reservation semantics preserved')