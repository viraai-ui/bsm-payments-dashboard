#!/usr/bin/env node
import crypto from 'node:crypto'
import { getGitHubDataObject, putGitHubDataObject } from '../src/lib/github-data-store.ts'
import { isPaymentOwnedBy } from '../src/lib/payments.ts'
import { pendingOrderSummaries } from '../src/lib/payment-settlement.ts'

const apply=process.argv.includes('--apply')
if(apply&&process.env.EXACT_KC_ARTS_CORRECTION_APPLY!=='YES')throw new Error('Apply requires EXACT_KC_ARTS_CORRECTION_APPLY=YES')
const objectPath='data/payments.json',source=await getGitHubDataObject(objectPath)
if(!source)throw new Error('Production payments store missing')
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),before=JSON.parse(source.bytes.toString('utf8'))
const targetId='payment-085a98a6-216a-4e02-8a5e-88f79a39b54f',orderId='1154219000036112004',orderNumber='SO-07832'
const target=before.payments.find(payment=>payment.id===targetId)
if(!target||target.customerName!=='KC ARTS'||target.salesOrderId!==orderId||target.salesOrderNumber!==orderNumber||target.orderTotal!==134520||target.paymentAmount!==5000||target.status!=='Payment Received'||target.createdBy!=='public-salesman'||target.ownerUserId!==undefined||target.salespersonName!==undefined||target.sourceProvenance?.sourceRecordId!==targetId||(target.attachments||[]).length!==1)throw new Error('Strong-match guard failed for the proven KC ARTS legacy receipt')
const linked=before.payments.filter(payment=>payment.salesOrderId===orderId||payment.salesOrderNumber===orderNumber)
if(linked.length!==2||linked.reduce((sum,p)=>sum+(p.status==='Payment Received'?p.paymentAmount:0),0)!==134520)throw new Error('KC ARTS exact ledger guard failed')
const karan={id:'u-sales4',name:'Karan Singh',email:'',username:'karan'},visible=payments=>payments.filter(payment=>payment.status==='Unauthorised'||isPaymentOwnedBy(payment,karan))
const beforePending=pendingOrderSummaries(visible(before.payments)),beforeOther=beforePending.filter(order=>order.salesOrderNumber!==orderNumber)
if(!beforePending.some(order=>order.salesOrderNumber===orderNumber&&order.orderTotal===134520&&order.received===129520&&order.outstanding===5000))throw new Error('Pre-mutation Karan projection does not reproduce the reported defect')
const now=new Date().toISOString(),output=structuredClone(before)
output.payments=output.payments.map(payment=>payment.id!==targetId?payment:{...payment,ownerUserId:karan.id,salespersonName:karan.name,updatedAt:now,audit:[...(payment.audit||[]),{id:`audit-${crypto.randomUUID()}`,type:'ownership_changed',actor:'Admin',at:now,reason:'Assign proven legacy KC ARTS receipt to Karan so the complete SO-07832 ledger is visible to its owner',changedFields:['ownerUserId','salespersonName']}]})
for(const payment of before.payments.filter(payment=>payment.id!==targetId)){const next=output.payments.find(candidate=>candidate.id===payment.id);if(JSON.stringify(next)!==JSON.stringify(payment))throw new Error(`Unexpected mutation: ${payment.id}`)}
const afterPending=pendingOrderSummaries(visible(output.payments)),afterOther=afterPending.filter(order=>order.salesOrderNumber!==orderNumber)
if(afterPending.some(order=>order.salesOrderNumber===orderNumber))throw new Error('KC ARTS remains pending after owner correction')
if(JSON.stringify(afterOther)!==JSON.stringify(beforeOther))throw new Error('Unrelated Karan pending order changed')
const outputBytes=Buffer.from(`${JSON.stringify(output,null,2)}\n`)
console.log(JSON.stringify({mode:apply?'apply':'dry-run',sourceGitBlobSha:source.sha,sourceSha256:sha256(source.bytes),outputSha256:sha256(outputBytes),target:{id:target.id,proofKey:target.attachments[0].key,sourceProvenance:target.sourceProvenance},ledger:linked.map(p=>({id:p.id,amount:p.paymentAmount,status:p.status,ownerUserId:p.ownerUserId,createdAt:p.createdAt,paymentDate:p.paymentDate})),karanPending:{before:beforePending.length,after:afterPending.length,removed:orderNumber,unrelatedPreserved:beforeOther.map(order=>order.salesOrderNumber)}},null,2))
if(!apply)process.exit(0)
const current=await getGitHubDataObject(objectPath)
if(!current||current.sha!==source.sha||!current.bytes.equals(source.bytes))throw new Error('CAS precondition failed')
const backupPath=`backups/kc-arts-owner-correction-${now.replace(/[:.]/g,'-')}-${source.sha.slice(0,12)}.json`
if(await getGitHubDataObject(backupPath))throw new Error('Backup already exists')
if(!await putGitHubDataObject(backupPath,source.bytes,`Byte-identical backup before KC ARTS owner correction (${source.sha})`))throw new Error('Backup write conflict')
const backup=await getGitHubDataObject(backupPath)
if(!backup||!backup.bytes.equals(source.bytes))throw new Error('Backup byte verification failed')
if(!await putGitHubDataObject(objectPath,outputBytes,'Correct ownership of proven KC ARTS SO-07832 legacy receipt',source.sha))throw new Error('Payments CAS write conflict')
const verified=await getGitHubDataObject(objectPath)
if(!verified||!verified.bytes.equals(outputBytes))throw new Error('Production read-back verification failed')
const live=JSON.parse(verified.bytes.toString('utf8')),receipt=live.payments.find(p=>p.id===targetId),livePending=pendingOrderSummaries(visible(live.payments))
if(receipt.ownerUserId!==karan.id||receipt.salespersonName!==karan.name||livePending.some(order=>order.salesOrderNumber===orderNumber))throw new Error('Live semantic verification failed')
console.log(JSON.stringify({verified:true,backupPath,backupSha256:sha256(backup.bytes),newGitBlobSha:verified.sha,readBackSha256:sha256(verified.bytes),receipt:{id:receipt.id,ownerUserId:receipt.ownerUserId,salespersonName:receipt.salespersonName,proofKey:receipt.attachments[0].key,audit:receipt.audit.at(-1)},karanPending:{count:livePending.length,orders:livePending.map(order=>order.salesOrderNumber)}},null,2))
