import { createHash } from 'node:crypto'

export const EXPECTED_UNLINKED_COUNT = 12
export const MIGRATION_ACTOR = 'system:migration:legacy-unlinked-claims-v1'
export const MIGRATION_AT = '2026-09-23T00:00:00.000Z'
export const MIGRATION_REASON = 'One-off migration of genuinely unresolved legacy receipt to the Unauthorised claim queue; source: post-reconciliation production audit (94/106 authoritatively linked). No order candidate was asserted.'
const stable = value => JSON.stringify(value)
const eventId = paymentId => `audit-unlinked-claim-v1-${createHash('sha256').update(String(paymentId)).digest('hex').slice(0,24)}`

export function buildUnlinkedClaimMigration(store, expectedCount=EXPECTED_UNLINKED_COUNT) {
  if(!store || !Array.isArray(store.payments))throw new Error('payments.json must contain a payments array')
  const ids=new Set()
  for(const payment of store.payments){if(!payment?.id||ids.has(payment.id))throw new Error(`Missing/duplicate payment ID: ${payment?.id||'<empty>'}`);ids.add(payment.id)}
  const targets=store.payments.filter(payment=>!String(payment.salesOrderId||'').trim()&&!String(payment.salesOrderNumber||'').trim())
  if(targets.length!==expectedCount)throw new Error(`Exact-count guard failed: expected ${expectedCount} records missing both order links, got ${targets.length}`)
  for(const payment of targets){
    if(!['Pending','Payment Received','Unauthorised'].includes(payment.status))throw new Error(`Unexpected unlinked status ${payment.status} for ${payment.id}`)
    const id=eventId(payment.id),matches=(payment.audit||[]).filter(item=>item.id===id)
    if(payment.status==='Unauthorised'){
      if(matches.length!==1||matches[0].type!=='status_changed'||matches[0].to!=='Unauthorised'||!['Pending','Payment Received'].includes(matches[0].from)||matches[0].actor!==MIGRATION_ACTOR||matches[0].at!==MIGRATION_AT||matches[0].reason!==MIGRATION_REASON)throw new Error(`Unauthorised unlinked record lacks the deterministic migration audit: ${payment.id}`)
    } else if(matches.length)throw new Error(`Migration audit exists before status migration: ${payment.id}`)
  }
  const output=structuredClone(store);let changed=0
  for(const payment of output.payments){
    if(String(payment.salesOrderId||'').trim()||String(payment.salesOrderNumber||'').trim())continue
    if(payment.status==='Unauthorised')continue
    const from=payment.status
    payment.status='Unauthorised'
    payment.audit=[...(payment.audit||[]),{id:eventId(payment.id),type:'status_changed',actor:MIGRATION_ACTOR,at:MIGRATION_AT,from,to:'Unauthorised',reason:MIGRATION_REASON}]
    changed++
  }
  assertSafeUnlinkedClaimMutation(store,output)
  return {output,report:{payments:store.payments.length,linked:store.payments.length-targets.length,unlinked:targets.length,changed,alreadyMigrated:targets.length-changed,statusesBefore:Object.fromEntries([...new Set(targets.map(p=>p.status))].sort().map(status=>[status,targets.filter(p=>p.status===status).length])),targetIds:targets.map(p=>p.id).sort()}}
}

export function assertSafeUnlinkedClaimMutation(before,after){
  if(!before||!after||before.payments.length!==after.payments.length)throw new Error('Payment count changed')
  for(let i=0;i<before.payments.length;i++){
    const a=before.payments[i],b=after.payments[i]
    if(a.id!==b.id)throw new Error(`Payment identity/order changed at index ${i}`)
    const unlinked=!String(a.salesOrderId||'').trim()&&!String(a.salesOrderNumber||'').trim()
    const fields=new Set([...Object.keys(a),...Object.keys(b)])
    for(const field of fields){
      if(unlinked&&(field==='status'||field==='audit'))continue
      if(stable(a[field])!==stable(b[field]))throw new Error(`Protected field ${field} changed for ${a.id}`)
    }
    if(!unlinked&&(a.status!==b.status||stable(a.audit)!==stable(b.audit)))throw new Error(`Linked record changed: ${a.id}`)
  }
}
export const contentDigest = bytes => createHash('sha256').update(bytes).digest('hex')
