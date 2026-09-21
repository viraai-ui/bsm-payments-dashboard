import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root=await mkdtemp(path.join(tmpdir(),'bsm-split-claims-'))
process.chdir(root);process.env.APP_LOCAL_ONLY='true'
const {createUnlinkedPayment,claimPayment,listPayments}=await import('../src/lib/payments.ts')
const {managementPaymentMetrics}=await import('../src/lib/management-payment-metrics.ts')
const {viewerPaymentMetrics}=await import('../src/lib/viewer-payment-metrics.ts')
const parent=(await createUnlinkedPayment({customerName:'Unknown',utrReference:'UTR-SPLIT-1',paymentAmount:1000,paymentMode:'UPI',status:'Unauthorised',createdBy:'accounts'},'parent_split_test_0001')).payment
const order=(id:string,total:number)=>({id,salesOrderNumber:`SO-${id}`,customerName:`Customer ${id}`,orderTotal:total,orderDate:'2026-09-21'})
const first=await claimPayment(parent.id,'sales-1','Sales One',order('A',600),400,'allocation_key_000001')
assert.equal(first?.paymentAmount,400);assert.equal(first?.parentPaymentId,parent.id);assert.equal(first?.utrReference,'UTR-SPLIT-1');assert.equal(first?.attachments,parent.attachments)
let rows=await listPayments(),source=rows.find(p=>p.id===parent.id)!
assert.deepEqual([source.paymentAmount,source.originalPaymentAmount,source.allocatedAmount,source.remainingAmount,source.status],[1000,1000,400,600,'Unauthorised'])
const duplicate=await claimPayment(parent.id,'sales-1','Sales One',order('A',600),400,'allocation_key_000001')
assert.equal(duplicate?.id,first?.id);assert.equal((await listPayments()).filter(p=>p.parentPaymentId===parent.id).length,1)
await assert.rejects(()=>claimPayment(parent.id,'sales-1','Sales One',order('B',1000),601,'allocation_key_000002'),/remaining amount/)
await assert.rejects(()=>claimPayment(parent.id,'sales-1','Sales One',order('C',500),501,'allocation_key_000003'),/outstanding balance/)
const second=await claimPayment(parent.id,'sales-2','Sales Two',order('B',1000),600,'allocation_key_000004')
assert.equal(second?.paymentAmount,600);rows=await listPayments();source=rows.find(p=>p.id===parent.id)!
assert.deepEqual([source.paymentAmount,source.allocatedAmount,source.remainingAmount,source.status],[1000,1000,0,'Unauthorised'])
assert.equal(rows.filter(p=>p.parentPaymentId===parent.id).length,2)
assert.equal(source.audit?.filter(e=>e.type==='allocated').length,2)
const management=managementPaymentMetrics(rows)
assert.equal(management.find(m=>m.key==='received')?.amount,1000,'children represent the received amount exactly once')
assert.equal(management.find(m=>m.key==='unauthorised')?.amount,0,'exhausted parent has no unauthorised exposure')
const viewer=viewerPaymentMetrics(rows,new Date())
assert.equal(viewer[0].amount,1000,'exhausted parent is not double-counted in received-today metrics')

const concurrent=(await createUnlinkedPayment({customerName:'Unknown',utrReference:'UTR-RACE',paymentAmount:500,paymentMode:'UPI',status:'Unauthorised',createdBy:'accounts'},'parent_split_test_0002')).payment
const outcomes=await Promise.allSettled([
  claimPayment(concurrent.id,'sales-1','Sales One',order('D',500),400,'allocation_key_race01'),
  claimPayment(concurrent.id,'sales-2','Sales Two',order('E',500),400,'allocation_key_race02')])
assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);assert.equal(outcomes.filter(o=>o.status==='rejected').length,1)
source=(await listPayments()).find(p=>p.id===concurrent.id)!;assert.deepEqual([source.allocatedAmount,source.remainingAmount,source.status],[400,100,'Unauthorised'])
await rm(root,{recursive:true,force:true})
console.log('PASS split claims: two-way allocation, derived remaining, exact exhaustion, limits, lineage, idempotency and concurrent over-allocation protection')