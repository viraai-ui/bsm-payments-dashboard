#!/usr/bin/env node
import assert from 'node:assert/strict'
import { buildFinalDispatchSync, SOURCE_ONLY_IDS, STATUS_IDS, COMPETENCE_ID } from './final-dispatch-sync-lib.mjs'
const sourceSha='fixture-source-sha', rows=[], orders=[]
const special=[...STATUS_IDS,COMPETENCE_ID], specialByIndex=new Map([[89,STATUS_IDS[0]],[90,STATUS_IDS[1]],[91,STATUS_IDS[2]],[94,COMPETENCE_ID]])
for(let i=0;i<106;i++){
  const id=specialByIndex.get(i)||`payment-fixture-${i}`,linked=i<94,status=i<89?'Payment Received':i<94?'Pending':'Unauthorised',so=linked?`SO-F${String(i).padStart(3,'0')}`:undefined
  const row={id,idempotencyKey:`key-${i}`,customerName:`Customer ${i}`,paymentAmount:10,paymentMode:'Bank Transfer',addedBy:'Fixture',remarks:'keep',attachments:[{key:`proof-${i}`}],ownerUserId:'owner',paymentDate:'2026-09-20',status,createdAt:'2026-09-20T00:00:00.000Z',updatedAt:'2026-09-20T00:00:00.000Z',audit:[{id:`old-${i}`}],...(linked?{salesOrderId:`order-${i}`,salesOrderNumber:so,orderTotal:100,salesOrderDate:'2026-09-20'}:{})}
  rows.push(row);if(linked)orders.push({id:`order-${i}`,salesOrderNumber:so,customerName:row.customerName,total:100,orderTotal:100,orderDate:'2026-09-20',currency:'INR'})
}
// The three approved rows must be linked Pending; Competence must be unlinked Unauthorised.
for(const id of STATUS_IDS)rows.find(r=>r.id===id).status='Pending'
const competence=rows.find(r=>r.id===COMPETENCE_ID);delete competence.salesOrderId;delete competence.salesOrderNumber;delete competence.orderTotal;delete competence.salesOrderDate;competence.status='Unauthorised'
const target={payments:rows},source={payments:structuredClone(rows)}
for(const id of special){const row=source.payments.find(r=>r.id===id);row.updatedAt='2026-09-23T12:00:00.000Z';row.status='Payment Received'}
const additions=[
 {id:SOURCE_ONLY_IDS[0],customerName:'Rajdhani Laminates',salesOrderNumber:'SO-08010'},
 {id:SOURCE_ONLY_IDS[1],customerName:'JN International',salesOrderNumber:'SO-08021'},
 {id:SOURCE_ONLY_IDS[2],customerName:'Great India'},
 {id:SOURCE_ONLY_IDS[3],customerName:'AIRCITY SHOES PRIVATE LIMITED',salesOrderNumber:'SO-08017'},
]
const ownerNames=['Shivani','Deepak','Ram','Karan']
for(const [i,p] of additions.entries()){source.payments.push({...p,idempotencyKey:`new-key-${i}`,paymentAmount:10,paymentMode:'Bank Transfer',addedBy:ownerNames[i],remarks:'proof',attachments:[{key:`new-proof-${i}`}],status:'Payment Received',createdAt:'2026-09-23T09:00:00.000Z',updatedAt:'2026-09-23T12:00:00.000Z'});if(p.salesOrderNumber)orders.push({id:`new-order-${i}`,salesOrderNumber:p.salesOrderNumber,customerName:p.customerName,total:100,orderTotal:100,orderDate:'2026-09-23',currency:'INR'})}
const beforeCompetence=JSON.stringify(competence), preserved=structuredClone(rows.find(r=>r.id===STATUS_IDS[0]))
const first=buildFinalDispatchSync(target,source,orders,sourceSha)
assert.deepEqual(first.report,{changed:7,payments:110,linked:97,unlinked:13,statuses:{'Payment Received':95,Pending:2,Unauthorised:13},sourceOnly:SOURCE_ONLY_IDS,sourceNewer:[...STATUS_IDS,COMPETENCE_ID]})
assert.equal(JSON.stringify(first.output.payments.find(r=>r.id===COMPETENCE_ID)),beforeCompetence)
const updated=first.output.payments.find(r=>r.id===STATUS_IDS[0]);for(const field of ['attachments','ownerUserId','paymentDate','remarks','salesOrderId'])assert.deepEqual(updated[field],preserved[field])
assert.equal(first.output.payments.find(r=>r.id===SOURCE_ONLY_IDS[2]).status,'Unauthorised')
assert.equal(buildFinalDispatchSync(first.output,source,orders,sourceSha).report.changed,0,'rerun must be idempotent')
const disabledLegacySource=structuredClone(source)
disabledLegacySource.payments=disabledLegacySource.payments.filter(row=>!SOURCE_ONLY_IDS.includes(row.id))
assert.equal(buildFinalDispatchSync(first.output,disabledLegacySource,orders,sourceSha).report.changed,0,'cut-over audit must remain idempotent after legacy source is disabled and target-only imports are absent upstream')
const badSource=structuredClone(source);badSource.payments.pop();assert.throws(()=>buildFinalDispatchSync(target,badSource,orders,sourceSha),/source-only/)
const duplicate=structuredClone(source);duplicate.payments[1].idempotencyKey=duplicate.payments[0].idempotencyKey;assert.throws(()=>buildFinalDispatchSync(target,duplicate,orders,sourceSha),/duplicate/)
const conflictOrders=structuredClone(orders);conflictOrders.find(o=>o.salesOrderNumber==='SO-08010').total=5;conflictOrders.find(o=>o.salesOrderNumber==='SO-08010').orderTotal=5;assert.throws(()=>buildFinalDispatchSync(target,source,conflictOrders,sourceSha),/aggregate payment/)
const ambiguous=[...orders,structuredClone(orders.find(o=>o.salesOrderNumber==='SO-08010'))];ambiguous.at(-1).id='other';assert.throws(()=>buildFinalDispatchSync(target,source,ambiguous,sourceSha),/expected one authoritative/)
console.log('final Dispatch sync verifier: PASS (exact output, guards, preservation, conflict/overpayment rejection, idempotency)')
