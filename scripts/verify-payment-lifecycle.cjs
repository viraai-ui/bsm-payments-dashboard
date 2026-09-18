const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript')
const source=fs.readFileSync('src/lib/payment-settlement.ts','utf8'),js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,m=new Module('settlement-test');m.filename=process.cwd()+'/settlement-test.js';m._compile(js,m.filename)
const {orderSummary,pendingOrderSummaries}=m.exports
const base={customerName:'Example Co',salesOrderNumber:'SO-25K',orderTotal:25000,paymentMode:'Bank Transfer',paymentDate:'2026-09-07',createdAt:'2026-09-07T00:00:00Z'}
const row=(id,amount,status)=>({...base,id,paymentAmount:amount,status})
let rows=[row('p',24000,'Pending')],s=orderSummary(rows,'SO-25K')
assert.deepEqual({confirmed:s.confirmedReceived,submitted:s.submittedAmount,confirmedOutstanding:s.confirmedOutstanding,provisional:s.provisionalOutstanding,pending:pendingOrderSummaries(rows).length},{confirmed:0,submitted:24000,confirmedOutstanding:25000,provisional:1000,pending:0})
rows=[row('p',24000,'Payment Received')];s=orderSummary(rows,'SO-25K');assert.deepEqual([s.confirmedReceived,s.provisionalOutstanding,pendingOrderSummaries(rows).length],[24000,1000,1])
rows=[row('full',25000,'Pending')];s=orderSummary(rows,'SO-25K');assert.deepEqual([s.provisionalOutstanding,pendingOrderSummaries(rows).length],[0,0])
rows=[row('full',25000,'Payment Received')];assert.equal(pendingOrderSummaries(rows).length,0)
rows=[row('received',10000,'Payment Received'),row('pending',12000,'Pending'),row('void',3000,'Void')];s=orderSummary(rows,'SO-25K');assert.deepEqual([s.confirmedReceived,s.submittedAmount,s.confirmedOutstanding,s.provisionalOutstanding,pendingOrderSummaries(rows).length],[10000,22000,15000,3000,1])
console.log('PASS settlement: 25k/24k pre/post approval, full receipt, mixed Pending+Received, Void exclusion, confirmed-only pending eligibility')
