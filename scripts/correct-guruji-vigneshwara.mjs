#!/usr/bin/env node
import crypto from 'node:crypto'
import { getGitHubDataObject, putGitHubDataObject } from '../src/lib/github-data-store.ts'
import { withAllocationBalances } from '../src/lib/payments.ts'

const apply=process.argv.includes('--apply')
if(apply&&process.env.EXACT_PAYMENT_CORRECTION_APPLY!=='YES')throw new Error('Apply requires EXACT_PAYMENT_CORRECTION_APPLY=YES')
const objectPath='data/payments.json',source=await getGitHubDataObject(objectPath)
if(!source)throw new Error('Production payments store missing')
const before=JSON.parse(source.bytes.toString('utf8')), sha256=b=>crypto.createHash('sha256').update(b).digest('hex')
const guruji=before.payments.filter(p=>p.id==='payment-5182546d-ca81-4e3d-a1c9-b47d9f5404e5'&&p.customerName==='Guruji Footwear'&&p.paymentDate==='2026-09-12'&&p.paymentAmount===55000&&p.status==='Unauthorised'&&p.ownerUserId==='u-sales2')
const vigneshwara=before.payments.filter(p=>p.id==='payment-bc5fe697-3490-43cc-97ee-3b03bfb2b365'&&p.customerName==='Vigneshwara Enterprises'&&p.paymentDate==='2026-09-05'&&p.paymentAmount===19200&&p.originalPaymentAmount===19200&&p.status==='Unauthorised')
if(guruji.length!==1||vigneshwara.length!==1)throw new Error(`Strong-match guard failed: Guruji=${guruji.length}, Vigneshwara=${vigneshwara.length}`)
const parent=vigneshwara[0],children=before.payments.filter(p=>p.parentPaymentId===parent.id),activeChildren=children.filter(p=>p.status!=='Void')
if(activeChildren.length!==1||activeChildren[0].id!=='payment-7cce08a4-a779-4196-9823-8b018a52baea'||activeChildren[0].paymentAmount!==15200||activeChildren[0].status!=='Payment Received')throw new Error('Vigneshwara child-allocation guard failed')
const now=new Date().toISOString(), output=structuredClone(before)
output.payments=output.payments.map(p=>{
 if(p.id===guruji[0].id)return{...p,ownerUserId:'u-sales4',salespersonName:'Karan Singh',updatedAt:now,audit:[...(p.audit||[]),{id:`audit-${crypto.randomUUID()}`,type:'ownership_changed',actor:'Admin',at:now,reason:'Correct salesperson ownership to active salesperson Karan',changedFields:['ownerUserId','salespersonName']}]}
 if(p.id===parent.id)return{...p,closedRemainderAmount:4000,closedRemainderReason:'Order complete',closedRemainderAt:now,closedRemainderBy:'Admin',updatedAt:now,audit:[...(p.audit||[]),{id:`audit-${crypto.randomUUID()}`,type:'remainder_closed',actor:'Admin',at:now,reason:'Order complete',amount:4000,from:'Unauthorised',to:'Unauthorised'}]}
 return p
})
const outputBytes=Buffer.from(`${JSON.stringify(output,null,2)}\n`),derived=withAllocationBalances(output.payments),vg=derived.find(p=>p.id===parent.id)
if(vg.paymentAmount!==19200||vg.allocatedAmount!==15200||vg.remainingAmount!==0)throw new Error('Derived closure verification failed')
for(const p of before.payments.filter(p=>![guruji[0].id,parent.id].includes(p.id))){const q=output.payments.find(x=>x.id===p.id);if(JSON.stringify(q)!==JSON.stringify(p))throw new Error(`Unexpected mutation: ${p.id}`)}
console.log(JSON.stringify({mode:apply?'apply':'dry-run',sourceGitBlobSha:source.sha,sourceSha256:sha256(source.bytes),outputSha256:sha256(outputBytes),matches:{guruji:guruji[0].id,vigneshwara:parent.id,child:activeChildren[0].id},derived:{original:vg.paymentAmount,allocated:vg.allocatedAmount,closed:vg.closedRemainderAmount,remaining:vg.remainingAmount}},null,2))
if(!apply)process.exit(0)
const current=await getGitHubDataObject(objectPath)
if(!current||current.sha!==source.sha||!current.bytes.equals(source.bytes))throw new Error('CAS precondition failed')
const stamp=now.replace(/[:.]/g,'-'),backupPath=`backups/exact-payment-correction-${stamp}-${source.sha.slice(0,12)}.json`
if(await getGitHubDataObject(backupPath))throw new Error('Backup already exists')
if(!await putGitHubDataObject(backupPath,source.bytes,`Byte-identical backup before exact Guruji/Vigneshwara correction (${source.sha})`))throw new Error('Backup write conflict')
const backup=await getGitHubDataObject(backupPath)
if(!backup||!backup.bytes.equals(source.bytes))throw new Error('Backup byte verification failed')
if(!await putGitHubDataObject(objectPath,outputBytes,'Correct Guruji owner and close Vigneshwara remainder',source.sha))throw new Error('Payments CAS write conflict')
const verified=await getGitHubDataObject(objectPath)
if(!verified||!verified.bytes.equals(outputBytes))throw new Error('Production read-back verification failed')
const live=withAllocationBalances(JSON.parse(verified.bytes.toString('utf8')).payments),g=live.find(p=>p.id===guruji[0].id),v=live.find(p=>p.id===parent.id),c=live.find(p=>p.id===activeChildren[0].id)
if(g.ownerUserId!=='u-sales4'||g.salespersonName!=='Karan Singh'||v.remainingAmount!==0||v.paymentAmount!==19200||c.paymentAmount!==15200||c.status!=='Payment Received')throw new Error('Live semantic verification failed')
if(live.some(p=>p.id===v.id&&p.status==='Unauthorised'&&(p.remainingAmount??p.paymentAmount)>0))throw new Error('Vigneshwara remains in active unauthorised queue')
console.log(JSON.stringify({verified:true,backupPath,backupSha256:sha256(backup.bytes),newGitBlobSha:verified.sha,guruji:{id:g.id,ownerUserId:g.ownerUserId,salespersonName:g.salespersonName},vigneshwara:{id:v.id,original:v.paymentAmount,allocated:v.allocatedAmount,closed:v.closedRemainderAmount,remaining:v.remainingAmount,activeUnauthorised:false},preservedChild:{id:c.id,amount:c.paymentAmount,status:c.status,attachments:(c.attachments||[]).length}},null,2))
