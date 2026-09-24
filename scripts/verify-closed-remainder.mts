import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.APP_LOCAL_ONLY='true'
const root=await mkdtemp(path.join(tmpdir(),'closed-remainder-'))
process.chdir(root)
await writeFile(path.join(root,'payments.json'),'') .catch(()=>{})
const payments=await import('../src/lib/payments.ts')
const metrics=await import('../src/lib/management-payment-metrics.ts')
const now='2026-09-05T00:00:00.000Z'
const parent:any={id:'parent',customerName:'Vigneshwara Enterprises',paymentAmount:19200,originalPaymentAmount:19200,closedRemainderAmount:4000,status:'Unauthorised',paymentDate:'2026-09-05',createdBy:'public-salesman',createdAt:now,updatedAt:now}
const child:any={...parent,id:'child',parentPaymentId:'parent',paymentAmount:15200,originalPaymentAmount:undefined,closedRemainderAmount:undefined,status:'Payment Received',ownerUserId:'u-sales2'}
const derived=payments.withAllocationBalances([parent,child])
assert.equal(derived[0].paymentAmount,19200,'original bank receipt remains unchanged')
assert.equal(derived[0].allocatedAmount,15200)
assert.equal(derived[0].remainingAmount,0,'closed remainder leaves no allocatable amount')
assert.equal(metrics.managementPaymentMetrics(derived).find(x=>x.key==='unauthorised')?.amount,0,'unauthorised metric excludes closed remainder')
assert.equal(derived.filter(p=>p.status==='Unauthorised'&&(p.remainingAmount??p.paymentAmount)>0).length,0,'closed receipt is absent from active queue')
console.log('closed-remainder: derivation, active tab/count, and metrics verified')