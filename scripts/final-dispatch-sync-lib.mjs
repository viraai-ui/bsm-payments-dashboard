import { createHash } from 'node:crypto'

export const SOURCE_ONLY_IDS = [
  'payment-24f82ecb-3943-4440-b5e6-caf8e45580f1',
  'payment-26647020-54a0-4255-9870-80c39d0de128',
  'payment-ce5bdbec-f3fc-49b8-8dcd-ab348ca052c4',
  'payment-4a0ee73b-7b92-4bd8-854f-d30e47448fb7',
]
export const STATUS_IDS = [
  'payment-e08e7ab2-516e-4470-9793-e71f2fdec15a',
  'payment-f0cf0b1b-c771-492c-9407-de51a68a5fe0',
  'payment-024dc393-dc2a-449f-baa4-8b5bb1b210ea',
]
export const COMPETENCE_ID = 'payment-e80749e8-4090-446c-b03b-4d816dbd3638'
const GREAT_INDIA_ID = 'payment-ce5bdbec-f3fc-49b8-8dcd-ab348ca052c4'
const stable = value => JSON.stringify(value)
const date = value => String(value || '').slice(0, 10)
const norm = value => String(value || '').trim().toUpperCase()
const total = order => Number(order.orderTotal ?? order.total)
export const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const auditId = (kind, id, sourceSha) => `audit-final-dispatch-${createHash('sha256').update(`${kind}:${id}:${sourceSha}`).digest('hex').slice(0,32)}`

function validateUnique(rows, label) {
  const ids=new Set(), keys=new Set()
  for(const row of rows){
    if(!row?.id || ids.has(row.id))throw new Error(`${label}: duplicate/empty payment id ${row?.id || ''}`);ids.add(row.id)
    if(!row.idempotencyKey || keys.has(row.idempotencyKey))throw new Error(`${label}: duplicate/empty idempotency key ${row.idempotencyKey || ''}`);keys.add(row.idempotencyKey)
  }
}
function statusAudit(payment, from, source, sourceSha) {
  const id=auditId('status',payment.id,sourceSha), existing=payment.audit || []
  if(existing.some(item=>item.id===id))return existing
  return [...existing,{id,type:'status_changed',actor:'final-dispatch-sync',at:source.updatedAt,from,to:'Payment Received',reason:`Final incremental sync from bsm-dispatch-dashboard ${sourceSha}`}]
}
function importAudit(payment, sourceSha, to) {
  return [{id:auditId('import',payment.id,sourceSha),type:'created',actor:'final-dispatch-sync',at:payment.createdAt,to,reason:`Final incremental sync from bsm-dispatch-dashboard ${sourceSha}`}]
}
function enrich(payment, order) {
  return {...payment,salesOrderId:String(order.id),salesOrderNumber:String(order.salesOrderNumber).trim(),orderTotal:total(order),salesOrderDate:date(order.orderDate),customerName:String(order.customerName).trim()}
}

export function buildFinalDispatchSync(targetStore, sourceStore, orders, sourceSha) {
  if(!targetStore?.payments || !Array.isArray(targetStore.payments)||!sourceStore?.payments||!Array.isArray(sourceStore.payments))throw new Error('Both stores must contain payments arrays')
  if(!sourceSha)throw new Error('Source Git SHA is required')
  validateUnique(targetStore.payments,'target');validateUnique(sourceStore.payments,'source')
  const targetById=new Map(targetStore.payments.map(p=>[p.id,p])),sourceById=new Map(sourceStore.payments.map(p=>[p.id,p]))
  const sourceOnly=sourceStore.payments.filter(p=>!targetById.has(p.id)).map(p=>p.id)
  const sourceNewer=sourceStore.payments.filter(p=>targetById.has(p.id)&&Date.parse(p.updatedAt)>Date.parse(targetById.get(p.id).updatedAt)).map(p=>p.id)
  const alreadyApplied=targetStore.payments.length===110&&SOURCE_ONLY_IDS.every(id=>targetById.has(id))&&STATUS_IDS.every(id=>targetById.get(id)?.status==='Payment Received')
  if(!alreadyApplied&&stable(sourceOnly)!==stable(SOURCE_ONLY_IDS))throw new Error(`Expected exact source-only IDs/order; got ${stable(sourceOnly)}`)
  if(!alreadyApplied&&(new Set(sourceNewer).size!==4||![...STATUS_IDS,COMPETENCE_ID].every(id=>sourceNewer.includes(id))))throw new Error(`Expected exact four source-newer IDs; got ${stable(sourceNewer)}`)
  const byNumber=new Map()
  for(const order of orders){const key=norm(order.salesOrderNumber);if(!key)continue;const list=byNumber.get(key)||[];list.push(order);byNumber.set(key,list)}
  let output=structuredClone(targetStore), changed=0, outById
  if(!alreadyApplied){
  for(const id of SOURCE_ONLY_IDS){
    let payment=structuredClone(sourceById.get(id))
    if(id===GREAT_INDIA_ID){
      if(payment.salesOrderId||payment.salesOrderNumber)throw new Error('Great India must remain unlinked')
      payment.status='Unauthorised';payment.audit=importAudit(payment,sourceSha,'Unauthorised')
    }else{
      const matches=byNumber.get(norm(payment.salesOrderNumber))||[]
      if(matches.length!==1)throw new Error(`${id}: expected one authoritative Zoho order, got ${matches.length}`)
      const order=matches[0]
      if(!Number.isFinite(total(order))||total(order)<=0)throw new Error(`${id}: invalid authoritative order total`)
      payment=enrich(payment,order);payment.status='Payment Received';payment.audit=importAudit(payment,sourceSha,'Payment Received')
    }
    payment.sourceProvenance={system:'bsm-dispatch-dashboard',commit:sourceSha,sourceSha256:digest(Buffer.from(JSON.stringify(sourceStore))),sourceRecordId:id}
    output.payments.push(payment);changed++
  }
  outById=new Map(output.payments.map(p=>[p.id,p]))
  for(const id of STATUS_IDS){const payment=outById.get(id),source=sourceById.get(id);if(!payment.salesOrderId||!payment.salesOrderNumber)throw new Error(`${id}: target row is not fully linked`);if(payment.status!=='Pending')throw new Error(`${id}: target status must be Pending`);payment.audit=statusAudit(payment,'Pending',source,sourceSha);payment.status='Payment Received';payment.updatedAt=source.updatedAt;changed++}
  }
  outById ||= new Map(output.payments.map(p=>[p.id,p]))
  if(stable(outById.get(COMPETENCE_ID))!==stable(targetById.get(COMPETENCE_ID)))throw new Error('Competence Export changed')
  validateUnique(output.payments,'output')
  const orderTotals=new Map(orders.map(o=>[norm(o.salesOrderNumber),total(o)])), paid=new Map()
  for(const p of output.payments)if(p.status!=='Void'&&p.salesOrderId&&p.salesOrderNumber)paid.set(norm(p.salesOrderNumber),(paid.get(norm(p.salesOrderNumber))||0)+Number(p.paymentAmount||0))
  for(const [number,amount] of paid)if(!orderTotals.has(number)||amount>orderTotals.get(number))throw new Error(`${number}: aggregate payment ${amount} exceeds/misses authoritative total ${orderTotals.get(number)}`)
  const linked=output.payments.filter(p=>p.salesOrderId&&p.salesOrderNumber).length
  if(output.payments.some(p=>Boolean(p.salesOrderId)!==Boolean(p.salesOrderNumber)))throw new Error('Half-linked payment detected')
  const statuses=Object.fromEntries(['Payment Received','Pending','Unauthorised'].map(s=>[s,output.payments.filter(p=>p.status===s).length]))
  const report={changed,payments:output.payments.length,linked,unlinked:output.payments.length-linked,statuses,sourceOnly,sourceNewer}
  if(report.payments!==110||linked!==97||report.unlinked!==13||statuses['Payment Received']!==95||statuses.Pending!==2||statuses.Unauthorised!==13)throw new Error(`Final invariant failed: ${stable(report)}`)
  return {output,report}
}
