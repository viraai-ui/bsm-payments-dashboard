import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const root=await mkdtemp(path.join(os.tmpdir(),'bsm-legacy-exclusion-'))
process.chdir(root);process.env.APP_LOCAL_ONLY='true';process.env.NODE_ENV='test'
await mkdir('data',{recursive:true});await writeFile('data/payments.json',JSON.stringify({payments:[]}))
const legacy=await import('../src/lib/legacy-sales-order-exclusions.ts')
const {selectSalespersonOverview}=await import('../src/lib/salesperson-overview.ts')
const order={id:'zoho-1',salesOrderNumber:'SO-00123',orderDate:'2026-01-01',customerName:'Legacy Customer',currency:'INR',orderTotal:5000,salespersonId:'u-sales1',salespersonName:'Sales One',salespersonEmail:'sales1@bsm.local',status:'open'} as never
const owner={id:'u-sales1',name:'Sales One',email:'sales1@bsm.local',username:'sales1',role:'Salesperson',active:true,createdAt:'',updatedAt:''} as const
const other={...owner,id:'u-sales2',name:'Sales Two',email:'sales2@bsm.local',username:'sales2'} as const
const accounts={...owner,id:'u-accounts',name:'Accounts',role:'Accounts'} as const
const ledgerBefore=await readFile('data/payments.json','utf8')
const first=await legacy.markLegacySalesOrderAlreadyReceived(order,[],owner,new Date('2026-10-07T10:00:00Z'))
assert.equal(first.created,true);assert.equal(first.marker.canonicalSalesOrderNumber,'SO00123');assert.equal(first.marker.actorUserId,owner.id);assert.equal(first.marker.originalOwnerUserId,owner.id)
const second=await legacy.markLegacySalesOrderAlreadyReceived(order,[],owner,new Date('2026-10-08T10:00:00Z'))
assert.equal(second.created,false);assert.equal(second.marker.markedAt,first.marker.markedAt)
assert.equal((await legacy.listLegacySalesOrderExclusions(true)).length,1,'marker persists and is readable')
await assert.rejects(()=>legacy.markLegacySalesOrderAlreadyReceived(order,[],other),error=>(error as {status?:number}).status===403)
await assert.rejects(()=>legacy.markLegacySalesOrderAlreadyReceived(order,[],accounts as never),error=>(error as {status?:number}).status===403)
process.env.LEGACY_ALREADY_RECEIVED_ENABLED='false'
await assert.rejects(()=>legacy.markLegacySalesOrderAlreadyReceived(order,[],owner),error=>(error as {status?:number}).status===403)
const overview=selectSalespersonOverview([order],[],owner,{lastSyncedAt:'2026-10-07T09:00:00Z',recencyVerifiedAt:'2026-10-07T09:00:00Z'},new Date('2026-10-07T10:00:00Z'),await legacy.listLegacySalesOrderExclusions(true))
assert.equal(overview.orders.length,0);assert.equal(overview.metrics.total,0);assert.equal(overview.legacyCleanupEnabled,false,'flag is exposed to hide UI')
assert.equal(await readFile('data/payments.json','utf8'),ledgerBefore,'payment ledger must remain byte-for-byte unchanged')
console.log('legacy already-received verification passed')
