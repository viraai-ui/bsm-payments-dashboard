import assert from 'node:assert/strict'
import { buildUnlinkedClaimMigration, assertSafeUnlinkedClaimMutation, MIGRATION_ACTOR, MIGRATION_AT } from './unlinked-claim-migration-lib.mjs'
const linked=Array.from({length:94},(_,i)=>({id:`l${i}`,customerName:'Linked',salesOrderId:`z${i}`,salesOrderNumber:`SO-${i}`,paymentAmount:10,paymentDate:'2026-01-01',status:'Payment Received',audit:[]}))
const unlinked=Array.from({length:12},(_,i)=>({id:`u${i}`,customerName:`Customer ${i}`,paymentAmount:20+i,paymentDate:'2025-01-02',attachments:[{key:`proof-${i}`}],status:i<9?'Payment Received':'Pending',audit:[]}))
const source={payments:[...linked,...unlinked]},snapshot=structuredClone(source),result=buildUnlinkedClaimMigration(source)
assert.deepEqual(source,snapshot,'input mutated');assert.equal(result.report.changed,12);assert.equal(result.report.linked,94)
for(let i=94;i<106;i++){const before=source.payments[i],after=result.output.payments[i],event=after.audit.at(-1);assert.equal(after.status,'Unauthorised');assert.equal(event.type,'status_changed');assert.equal(event.from,before.status);assert.equal(event.to,'Unauthorised');assert.equal(event.actor,MIGRATION_ACTOR);assert.equal(event.at,MIGRATION_AT);for(const field of ['customerName','paymentAmount','paymentDate','attachments'])assert.deepEqual(after[field],before[field])}
assert.deepEqual(result.output.payments.slice(0,94),linked,'linked records changed')
const rerun=buildUnlinkedClaimMigration(result.output);assert.equal(rerun.report.changed,0);assert.deepEqual(rerun.output,result.output,'rerun is not byte-structurally idempotent')
assert.throws(()=>buildUnlinkedClaimMigration({payments:source.payments.slice(0,105)}),/Exact-count guard/)
const bad=structuredClone(result.output);bad.payments[94].salesOrderId='unexpected';assert.throws(()=>buildUnlinkedClaimMigration(bad),/Exact-count guard/)
const altered=structuredClone(result.output);altered.payments[0].status='Pending';assert.throws(()=>assertSafeUnlinkedClaimMutation(result.output,altered),/Protected field|Linked record/)
console.log('unlinked claim migration verification passed')
