import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root=await mkdtemp(path.join(tmpdir(),'bsm-amount-only-'))
process.chdir(root);process.env.APP_LOCAL_ONLY='true'
const domain=await import('../src/lib/payment-domain.ts')
const {createUnlinkedPayment}=await import('../src/lib/payments.ts')

for(const role of ['Admin','Accounts']){
 const parsed=domain.parseUnauthorisedPaymentInput({paymentAmount:'1250.50',customerName:'',utrReference:'',paymentDate:'',paymentMode:'',proofs:'',remarks:'',ownerUserId:'forged-owner'})
 assert.equal(parsed.ok,true,`${role} amount-only payload accepted`)
 if(!parsed.ok)continue
 const key=`amount_only_${role.toLowerCase()}_0001`
 const first=await createUnlinkedPayment({...parsed.value,status:'Unauthorised',createdBy:`${role.toLowerCase()}-fixture`},key)
 const retry=await createUnlinkedPayment({...parsed.value,status:'Unauthorised',createdBy:`${role.toLowerCase()}-fixture`},key)
 assert.equal(first.payment.id,retry.payment.id);assert.equal(retry.duplicate,true)
 assert.equal(first.payment.customerName,'');assert.equal(first.payment.utrReference,'');assert.equal(first.payment.paymentMode,undefined)
 assert.equal(first.payment.ownerUserId,undefined);assert.equal(first.payment.paymentDate,new Date().toISOString().slice(0,10))
}
for(const bad of ['', '0', '-1', 'wat', '1.001'])assert.equal(domain.parseUnauthorisedPaymentInput({paymentAmount:bad}).ok,false,`${bad||'missing'} rejected`)
const a=domain.parseUnauthorisedPaymentInput({paymentAmount:'99'}),b=domain.parseUnauthorisedPaymentInput({paymentAmount:'99'})
assert.equal(a.ok&&b.ok,true)
if(!a.ok||!b.ok)throw new Error('valid fixtures unexpectedly rejected')
const payload={paymentAmount:99,customerName:'',utrReference:'',status:'Unauthorised' as const,createdBy:'fixture'}
const one=await createUnlinkedPayment(payload,'distinct_request_key_001')
const two=await createUnlinkedPayment(payload,'distinct_request_key_002')
assert.notEqual(one.payment.id,two.payment.id,'same blank UTR and amount do not dedupe')
assert.equal(domain.paymentCustomerLabel(''),'Unidentified customer')
const ui=await readFile(path.join(import.meta.dirname,'../src/components/PaymentsClient.tsx'),'utf8')
assert.match(ui,/UTR \/ Reference Number <small>Optional<\/small>/);assert.doesNotMatch(ui,/UTR \/ Reference Number[\s\S]{0,120}<input\s+required/)
assert.match(ui,/Payment Amount <span aria-hidden="true">\*<\/span>[\s\S]{0,180}<input\s+required/)
console.log('unauthorised amount-only contract verified')