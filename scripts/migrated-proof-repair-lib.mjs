import { createHash } from 'node:crypto'

export const MIGRATED_PROOFS = [
  { paymentId:'payment-26647020-54a0-4255-9870-80c39d0de128', sourceKey:'payments/public/SO-08021/2026-09-23/1790164394934-a177e75d-6d29-4b34-a383-769eadd30ed7-642bb172-7aa9-4d1c-a13d-f77bfff9a423.jpg', sha256:'c476b0bcc30b9bdb1e742cfc04d3b9baec5d782299b2fc2f0017ca87d37da266', size:165450, name:'642bb172-7aa9-4d1c-a13d-f77bfff9a423.jpg' },
  { paymentId:'payment-ce5bdbec-f3fc-49b8-8dcd-ab348ca052c4', sourceKey:'payments/public/manual/10dacf54-1f05-42e1-9858-ba3859957909/2026-09-23/1790157009508-90c81072-e740-482e-82b0-7ff9e6523642-WhatsApp-Image-2026-09-23-at-3.19.13-PM.jpg', sha256:'d5371b1956b438152e5a3b6c2bc273fb2ce174ed31d956f35cf57f951aee4b8e', size:63584, name:'WhatsApp Image 2026-09-23 at 3.19.13 PM.jpeg' },
]
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export function githubProofKey(spec){return `proofs/${spec.paymentId}/${spec.sha256}.jpg`}
export function assertAndBuildRepair(store, files){
  if(!store?.payments||!Array.isArray(store.payments))throw new Error('Invalid payments store')
  const output=structuredClone(store), repairs=[]
  for(const spec of MIGRATED_PROOFS){
    const payment=output.payments.find(row=>row.id===spec.paymentId)
    if(!payment)throw new Error(`${spec.paymentId}: payment missing`)
    if(!Array.isArray(payment.attachments)||payment.attachments.length!==1||payment.attachments[0].key!==spec.sourceKey)throw new Error(`${spec.paymentId}: attachment changed; refusing repair`)
    const bytes=files.get(spec.paymentId)
    if(!bytes||bytes.length!==spec.size||sha256(bytes)!==spec.sha256||bytes[0]!==0xff||bytes[1]!==0xd8||bytes[2]!==0xff)throw new Error(`${spec.paymentId}: source proof bytes failed size/hash/JPEG verification`)
    const key=githubProofKey(spec)
    payment.attachments=[{...payment.attachments[0],key,url:`/api/payments/${encodeURIComponent(payment.id)}/proof?index=0`,name:spec.name,contentType:'image/jpeg',size:spec.size}]
    repairs.push({paymentId:payment.id,sourceKey:spec.sourceKey,key,size:spec.size,sha256:spec.sha256})
  }
  return {output,repairs}
}
