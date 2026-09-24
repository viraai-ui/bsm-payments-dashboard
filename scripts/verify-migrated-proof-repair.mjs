import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { MIGRATED_PROOFS, assertAndBuildRepair, githubProofKey } from './migrated-proof-repair-lib.mjs'
const files=new Map(MIGRATED_PROOFS.map(spec=>[spec.paymentId,Buffer.concat([Buffer.from([0xff,0xd8,0xff]),Buffer.alloc(spec.size-3)])]))
// Replace fixture hashes in-memory so guards are tested without embedding production proof bytes.
const specs=MIGRATED_PROOFS.map(spec=>({...spec,sha256:createHash('sha256').update(files.get(spec.paymentId)).digest('hex')}))
for(let i=0;i<specs.length;i++)Object.assign(MIGRATED_PROOFS[i],specs[i])
const store={payments:MIGRATED_PROOFS.map(spec=>({id:spec.paymentId,attachments:[{key:spec.sourceKey,url:'legacy',name:spec.name,contentType:'image/jpeg',size:spec.size}]}))}
const {output,repairs}=assertAndBuildRepair(store,files)
assert.equal(repairs.length,2);assert.notEqual(output,store)
for(const [i,spec] of MIGRATED_PROOFS.entries()){assert.equal(output.payments[i].attachments[0].key,githubProofKey(spec));assert.equal(output.payments[i].attachments[0].url,`/api/payments/${spec.paymentId}/proof?index=0`);assert.equal(store.payments[i].attachments[0].key,spec.sourceKey)}
assert.throws(()=>assertAndBuildRepair({payments:[]},files),/payment missing/)
const bad=new Map(files);bad.set(MIGRATED_PROOFS[0].paymentId,Buffer.alloc(MIGRATED_PROOFS[0].size));assert.throws(()=>assertAndBuildRepair(store,bad),/verification/)
console.log('migrated proof repair verification passed')
