import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'

const repo=path.resolve(import.meta.dirname,'..')
const ui=await readFile(path.join(repo,'src/components/PaymentsClient.tsx'),'utf8')
assert.match(ui,/role === "Salesperson" && p\.ownerUserId === userId && p\.claimedBy === userId/,'Regular overflow must expose own-allocation Delete only by stable IDs')
const root=await mkdtemp(path.join(tmpdir(),'bsm-owner-reversal-'))
process.chdir(root);process.env.APP_LOCAL_ONLY='true'
const {createUnlinkedPayment,claimPayment,listPayments,reverseClaimedAllocation,canReverseClaimedAllocation}=await import('../src/lib/payments.ts')
const source=(await createUnlinkedPayment({customerName:'IBS Safety Fixture',utrReference:'UTR-OWNER',paymentAmount:1000,paymentMode:'UPI',status:'Unauthorised',createdBy:'accounts'},'owner_reversal_parent')).payment
const child=await claimPayment(source.id,'sales-owner','Owner', {id:'order-1',salesOrderNumber:'SO-1',customerName:'IBS Safety Fixture',orderTotal:1000,orderDate:'2026-09-24'},400,'owner_reversal_child')
assert.ok(child)
assert.equal(canReverseClaimedAllocation(child!,{id:'sales-owner',role:'Salesperson'}),true)
assert.equal(canReverseClaimedAllocation(child!,{id:'sales-other',role:'Salesperson'}),false)
assert.equal(canReverseClaimedAllocation({...child!,ownerUserId:'sales-owner',claimedBy:'sales-other'},{id:'sales-owner',role:'Salesperson'}),false,'forged/mismatched identity must fail closed')
await assert.rejects(()=>reverseClaimedAllocation(child!.id,{id:'sales-other',role:'Salesperson'},'not mine'),/cannot reverse/)
let rows=await listPayments();assert.equal(rows.find(p=>p.id===source.id)?.remainingAmount,600)
const result=await reverseClaimedAllocation(child!.id,{id:'sales-owner',role:'Salesperson'},'Own claim entered in error')
assert.equal(result.changed,true);assert.equal((result.payment as any)?.status,'Void');assert.equal((result.payment as any)?.utrReference,'UTR-OWNER')
rows=await listPayments();assert.equal(rows.find(p=>p.id===source.id)?.remainingAmount,1000);assert.equal(rows.find(p=>p.id===source.id)?.audit?.at(-1)?.actor,'sales-owner')
const retry=await reverseClaimedAllocation(child!.id,{id:'sales-owner',role:'Salesperson'},'retry')
assert.equal(retry.changed,false);rows=await listPayments();assert.equal(rows.find(p=>p.id===child!.id)?.audit?.filter(e=>e.type==='allocation_reversed').length,1)
await assert.rejects(()=>reverseClaimedAllocation(source.id,{id:'sales-owner',role:'Salesperson'},'parent'),/cannot reverse/)
await rm(root,{recursive:true,force:true})
console.log('PASS salesperson allocation reversal: owner success, non-owner/forged/parent denial, idempotency and parent restoration')
