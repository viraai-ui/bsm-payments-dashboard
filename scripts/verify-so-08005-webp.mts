import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createLinkedPayment, deletePayment, setPaymentAttachments, type Payment } from '../src/lib/payments'
import { deleteProofAttachments, readProof, storeProofFiles } from '../src/lib/local-payment-proofs'
import { reconciliationBatch, type SalesOrderSnapshot } from '../src/lib/sales-order-reconciliation'

const paymentsFile=path.resolve('data/payments.json'),backup=await readFile(paymentsFile),key=`qa-so-08005-${crypto.randomUUID()}`
let id='',attachments:Awaited<ReturnType<typeof storeProofFiles>>=[]
try{
 const fixture=JSON.parse(backup.toString()) as {payments:Payment[]}
 await writeFile(paymentsFile,JSON.stringify({payments:fixture.payments.filter(payment=>payment.salesOrderNumber!=='SO-08005')},null,2))
 const created=await createLinkedPayment({customerName:'RNC IMPEX PRIVATE LIMITED',salesOrderId:'qa-zoho-so-08005',salesOrderNumber:'SO-08005',orderTotal:1365880,salesOrderDate:'2026-09-22',paymentAmount:1365880,paymentMode:'Bank Transfer',createdBy:'qa-salesperson',ownerUserId:'qa-salesperson',addedBy:'QA',salespersonName:'QA'},key)
 id=created.payment.id
 const bytes=Uint8Array.from([82,73,70,70,4,0,0,0,87,69,66,80,86,80,56,32])
 attachments=await storeProofFiles(id,[new File([bytes],'SO-08005-proof.webp',{type:'image/webp'})])
 const saved=await setPaymentAttachments(id,attachments) as Payment|null
 if(!saved)throw new Error('payment attachment finalization failed')
 assert.equal(saved.paymentAmount,1365880);assert.equal(saved.status,'Pending');assert.equal(attachments[0].contentType,'image/webp');assert.deepEqual(new Uint8Array((await readProof(attachments[0].key))!),bytes)
 const snapshots={new:{syncedAt:'2026-09-25T00:00:00Z'},old:{syncedAt:'2026-09-20T00:00:00Z'}} as unknown as Record<string,SalesOrderSnapshot>
 assert.deepEqual(reconciliationBatch(['new','missing','old'],snapshots,2),['missing','old'])
 console.log('PASS SO-08005 full-pending payment persists with authenticated WebP proof; reconciliation is bounded oldest-first')
}finally{
 if(id)await deletePayment(id).catch(()=>null)
 if(attachments.length)await deleteProofAttachments(attachments)
 if(id)await rm(path.resolve('data/uploads/payment-proofs',id),{recursive:true,force:true})
 await writeFile(paymentsFile,backup)
}