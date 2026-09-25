#!/usr/bin/env node
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { getGitHubDataObject, putGitHubDataObject } from '../src/lib/github-data-store.ts'
import { orderSummary, pendingOrderSummaries } from '../src/lib/payment-settlement.ts'
import { pendingOrdersForUser, isPaymentOwnedBy } from '../src/lib/payments.ts'

const APPLY=process.argv.includes('--apply')
const ORDER_ID='manual-so-07760', PAYMENT_ID='payment-manual-so-07760-20260825'
const IDEMPOTENCY_KEY='manual-pdf:SO-07760:2026-08-25:280000'
const REASON='Manual entry from supplied Sales Order PDF due Zoho outage'
const paths={payments:'data/payments.json',index:'data/payment-order-index.json',users:'data/auth-users-store.json'}
const sha256=b=>crypto.createHash('sha256').update(b).digest('hex')
const norm=v=>String(v||'').replace(/[^A-Z0-9]/gi,'').toUpperCase()
const read=async p=>{const o=await getGitHubDataObject(p);if(!o)throw new Error(`Missing production store ${p}`);return o}
const encode=v=>Buffer.from(`${JSON.stringify(v,null,2)}\n`)

const [payObj,indexObj,userObj]=await Promise.all(Object.values(paths).map(read))
const payments=JSON.parse(payObj.bytes), index=JSON.parse(indexObj.bytes), users=JSON.parse(userObj.bytes)
const anuj=users.users.filter(u=>u.active&&u.role==='Salesperson'&&u.name==='Anuj Kumar')
assert.equal(anuj.length,1,'Expected exactly one active Anuj Kumar Salesperson')
const owner=anuj[0]
const existingPayments=payments.payments.filter(p=>norm(p.salesOrderNumber)==='SO07760'||p.id===PAYMENT_ID||p.idempotencyKey===IDEMPOTENCY_KEY)
const existingOrders=Object.values(index.orders||{}).filter(o=>norm(o.salesOrderNumber)==='SO07760'||o.id===ORDER_ID)
if(existingPayments.length||existingOrders.length){
 assert.equal(existingPayments.length,1,'Partial/duplicate SO-07760 payment state')
 assert.equal(existingOrders.length,1,'Partial/duplicate SO-07760 order-index state')
 verify(payments,index,owner)
 console.log(JSON.stringify({mode:APPLY?'apply':'dry-run',idempotent:true,noWrite:true,paymentId:PAYMENT_ID,ownerUserId:owner.id,production:{paymentsBlobSha:payObj.sha,indexBlobSha:indexObj.sha,paymentsSha256:sha256(payObj.bytes),indexSha256:sha256(indexObj.bytes)},verification:verification(payments,index,owner)},null,2));process.exit(0)
}
const at=new Date().toISOString()
const payment={id:PAYMENT_ID,customerName:'BELGI FOOTWEAR LLP',salesOrderId:ORDER_ID,salesOrderNumber:'SO-07760',orderTotal:294000,salesOrderDate:'2026-08-19',paymentAmount:280000,paymentMode:'Bank Transfer',paymentDate:'2026-08-25',attachments:[],remarks:REASON,addedBy:owner.name,salespersonName:owner.name,ownerUserId:owner.id,status:'Payment Received',createdBy:owner.id,confirmedAt:'2026-08-25T00:00:00.000Z',idempotencyKey:IDEMPOTENCY_KEY,createdAt:at,updatedAt:at,audit:[{id:`audit-manual-so-07760-created`,type:'created',actor:'manual-production-migration',at,to:'Payment Received',reason:REASON}]}
const order={id:ORDER_ID,salesOrderNumber:'SO-07760',customerName:'BELGI FOOTWEAR LLP',status:'confirmed',orderDate:'2026-08-19',orderTotal:294000,currency:'INR',modifiedTime:at,manualSource:{reason:REASON,subtotal:280000,igst:14000,pdfDealWith:'Anuj Kumar',enteredAt:at}}
const nextPayments={...payments,payments:[payment,...payments.payments]}
const nextIndex=structuredClone(index);nextIndex.orders={...(nextIndex.orders||{}),[ORDER_ID]:order};nextIndex.updatedAt=at
verify(nextPayments,nextIndex,owner)
const payBytes=encode(nextPayments),indexBytes=encode(nextIndex)
const pre={payments:{path:paths.payments,blobSha:payObj.sha,sha256:sha256(payObj.bytes)},index:{path:paths.index,blobSha:indexObj.sha,sha256:sha256(indexObj.bytes)}}
console.log(JSON.stringify({mode:APPLY?'apply':'dry-run',idempotent:false,paymentId:PAYMENT_ID,ownerUserId:owner.id,before:pre,after:{paymentsSha256:sha256(payBytes),indexSha256:sha256(indexBytes)},verification:verification(nextPayments,nextIndex,owner)},null,2))
if(!APPLY)process.exit(0)
const stamp=at.replace(/[:.]/g,'-'),backups={payments:`backups/manual-so-07760/${stamp}-payments-${payObj.sha.slice(0,12)}.json`,index:`backups/manual-so-07760/${stamp}-payment-order-index-${indexObj.sha.slice(0,12)}.json`}
for(const [name,obj] of [['payments',payObj],['index',indexObj]]){assert.equal(await getGitHubDataObject(backups[name]),null,`Backup exists: ${backups[name]}`);assert.equal(await putGitHubDataObject(backups[name],obj.bytes,`Backup ${paths[name]} before manual SO-07760 (${obj.sha})`),true);const copy=await read(backups[name]);assert.equal(sha256(copy.bytes),sha256(obj.bytes),'Backup hash mismatch')}
// Index first: exposing an order with no receipt briefly is safer than exposing a receipt without its manual order.
assert.equal(await putGitHubDataObject(paths.index,indexBytes,`${REASON}: index SO-07760`,indexObj.sha),true,'Index CAS conflict')
assert.equal(await putGitHubDataObject(paths.payments,payBytes,`${REASON}: received payment SO-07760`,payObj.sha),true,'Payments CAS conflict')
const [finalPay,finalIndex]=await Promise.all([read(paths.payments),read(paths.index)])
assert.equal(sha256(finalPay.bytes),sha256(payBytes));assert.equal(sha256(finalIndex.bytes),sha256(indexBytes))
const fp=JSON.parse(finalPay.bytes),fi=JSON.parse(finalIndex.bytes);verify(fp,fi,owner)
console.log(JSON.stringify({verified:true,paymentId:PAYMENT_ID,backups:{payments:{path:backups.payments,sha256:sha256(payObj.bytes)},index:{path:backups.index,sha256:sha256(indexObj.bytes)}},production:{paymentsBlobSha:finalPay.sha,indexBlobSha:finalIndex.sha,paymentsSha256:sha256(finalPay.bytes),indexSha256:sha256(finalIndex.bytes)},verification:verification(fp,fi,owner)},null,2))

function verification(pstore,istore,user){const rows=pstore.payments.filter(p=>norm(p.salesOrderNumber)==='SO07760'),orders=Object.values(istore.orders||{}).filter(o=>norm(o.salesOrderNumber)==='SO07760'),summary=orderSummary(pstore.payments,'SO-07760',294000,ORDER_ID),pending=pendingOrdersForUser(pstore.payments,user).find(o=>norm(o.salesOrderNumber)==='SO07760');return{paymentCount:rows.length,indexCount:orders.length,owner:user.id,status:rows[0]?.status,amount:rows[0]?.paymentAmount,paymentDate:rows[0]?.paymentDate,paymentMode:rows[0]?.paymentMode,orderDate:rows[0]?.salesOrderDate,orderTotal:summary.orderTotal,received:summary.received,pending:summary.outstanding,visibleInAnujPending:Boolean(pending),anujPending:pending?.outstanding}}
function verify(pstore,istore,user){const rows=pstore.payments.filter(p=>norm(p.salesOrderNumber)==='SO07760'),orders=Object.values(istore.orders||{}).filter(o=>norm(o.salesOrderNumber)==='SO07760');assert.equal(rows.length,1);assert.equal(orders.length,1);const p=rows[0],o=orders[0];assert.deepEqual({id:p.id,customer:p.customerName,orderId:p.salesOrderId,total:p.orderTotal,orderDate:p.salesOrderDate,amount:p.paymentAmount,date:p.paymentDate,mode:p.paymentMode,status:p.status,owner:p.ownerUserId,proofs:p.attachments},{id:PAYMENT_ID,customer:'BELGI FOOTWEAR LLP',orderId:ORDER_ID,total:294000,orderDate:'2026-08-19',amount:280000,date:'2026-08-25',mode:'Bank Transfer',status:'Payment Received',owner:user.id,proofs:[]});assert.equal(o.orderTotal,294000);assert.equal(o.orderDate,'2026-08-19');assert.equal(o.manualSource.subtotal,280000);assert.equal(o.manualSource.igst,14000);assert.equal(isPaymentOwnedBy(p,user),true);const s=orderSummary(pstore.payments,'SO-07760',294000,ORDER_ID);assert.equal(s.received,280000);assert.equal(s.outstanding,14000);const pending=pendingOrdersForUser(pstore.payments,user).filter(x=>norm(x.salesOrderNumber)==='SO07760');assert.equal(pending.length,1);assert.equal(pending[0].outstanding,14000)}
