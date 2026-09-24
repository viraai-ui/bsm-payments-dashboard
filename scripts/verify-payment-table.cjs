const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),Module=require('node:module')
const file=path.join(__dirname,'../src/lib/payment-settlement.ts'),source=fs.readFileSync(file,'utf8'),js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,m=new Module(file);m.filename=file;m.paths=module.paths;m._compile(js,file)
const {paymentOutstandingById,sortPayments,pendingOrderSummaries}=m.exports
const metricsFile=path.join(__dirname,'../src/lib/management-payment-metrics.ts'),metricsJs=ts.transpileModule(fs.readFileSync(metricsFile,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,mm=new Module(metricsFile);mm.filename=metricsFile;mm.paths=module.paths;mm.require=id=>id==='./payment-settlement'?m.exports:require(id);mm._compile(metricsJs,metricsFile);const {managementPaymentMetrics}=mm.exports
const base={customerName:'V.S. ENTERPRISES',salesOrderId:'zoho-7976',salesOrderNumber:'SO-07976',orderTotal:53100,paymentDate:'2026-09-18'}
const p=(id,amount,status,createdAt)=>({...base,id,paymentAmount:amount,status,createdAt})
let rows=[p('first',555,'Payment Received','2026-09-18T09:00:00Z'),p('second',52545,'Pending','2026-09-18T10:00:00Z')]
let balances=paymentOutstandingById(rows);assert.equal(balances.get('first'),52545);assert.equal(balances.get('second'),0);assert.equal(rows[1].paymentAmount,52545)
assert.equal(sortPayments(rows)[0].id,'second','newest row displays latest balance')
const chronology=[
 {...p('new-created',100,'Pending','2026-09-20T10:00:00Z'),paymentDate:'2026-01-01',updatedAt:'2026-09-20T10:00:00Z'},
 {...p('old-edited',100,'Pending','2026-09-19T10:00:00Z'),paymentDate:'2026-12-31',updatedAt:'2027-01-01T00:00:00Z'},
 {...p('tie-z',100,'Pending','2026-09-18T10:00:00Z'),paymentDate:'2026-09-18'},
 {...p('tie-a',100,'Pending','2026-09-18T10:00:00Z'),paymentDate:'2026-09-18'},
 {...p('legacy-new',100,'Pending',undefined),paymentDate:'2026-09-17'},
 {...p('legacy-old',100,'Pending',undefined),paymentDate:'2026-09-16'},
]
assert.deepEqual(sortPayments(chronology).map(x=>x.id),['new-created','old-edited','tie-z','tie-a','legacy-new','legacy-old'],'createdAt wins over payment date and updates; id and legacy date are stable fallbacks')
const orderReceipt=(id,so,status,createdAt,paymentDate='2026-09-01')=>({id,customerName:so,salesOrderNumber:so,orderTotal:1000,paymentAmount:100,status,createdAt,paymentDate})
const orders=[
 orderReceipt('received-a','SO-A','Payment Received','2026-09-01T00:00:00Z'),orderReceipt('pending-a','SO-A','Pending','2026-09-20T00:00:00Z','2026-01-01'),
 orderReceipt('received-b','SO-B','Payment Received','2026-09-19T00:00:00Z'),orderReceipt('pending-b','SO-B','Pending','2026-09-18T00:00:00Z','2026-12-31'),
 orderReceipt('received-c','SO-C','Payment Received','2026-09-17T00:00:00Z'),{...orderReceipt('legacy-c','SO-C','Pending',undefined,'2026-09-17')},
]
assert.deepEqual(pendingOrderSummaries(orders).map(x=>x.salesOrderNumber),['SO-A','SO-B','SO-C'],'order-level pending view follows newest pending receipt creation, not payment or SO date')
assert.deepEqual(pendingOrderSummaries(orders.map(x=>x.id==='pending-b'?{...x,updatedAt:'2027-01-01T00:00:00Z'}:x)).map(x=>x.salesOrderNumber),['SO-A','SO-B','SO-C'],'editing an older receipt does not move its order')
assert.equal(paymentOutstandingById([p('only',555,'Pending','2026-09-18T09:00:00Z')]).get('only'),52545)
const received=[p('rollback',555,'Payment Received','2026-09-18T09:00:00Z')],pending=[{...received[0],status:'Pending'}];const before=managementPaymentMetrics(received),after=managementPaymentMetrics(pending);assert.equal(before.find(x=>x.key==='received').amount-after.find(x=>x.key==='received').amount,555);assert.equal(after.find(x=>x.key==='pending-receipts').amount-before.find(x=>x.key==='pending-receipts').amount,555);assert.equal(after.find(x=>x.key==='pending-payments').amount,before.find(x=>x.key==='pending-payments').amount)
rows=[p('a',555,'Pending','2026-09-18T09:00:00Z'),p('b',52545,'Payment Received','2026-09-18T10:00:00Z'),p('void',900,'Void','2026-09-18T11:00:00Z'),p('unauth',900,'Unauthorised','2026-09-18T12:00:00Z')];balances=paymentOutstandingById(rows);assert.equal(balances.get('b'),0);assert.equal(balances.get('void'),0);assert.equal(balances.get('unauth'),0)
rows=[p('a',100,'Pending','2026-09-18T09:00:00Z'),p('b',200,'Pending','2026-09-18T09:00:00Z')];balances=paymentOutstandingById(rows);assert.equal(balances.get('a'),53000);assert.equal(balances.get('b'),52800)
rows=[p('same',555,'Pending','2026-09-18T09:00:00Z'),p('same',555,'Payment Received','2026-09-18T10:00:00Z')];assert.equal(paymentOutstandingById(rows).size,1)
const ui=fs.readFileSync(path.join(__dirname,'../src/components/PaymentsClient.tsx'),'utf8');assert.match(ui,/<th>Receipt<\/th>/);assert.match(ui,/<dt>Receipt<\/dt>/);assert.match(ui,/money\(p\.paymentAmount\)/);assert.match(ui,/paymentOutstandingById\(payments\)/);assert.match(ui,/salespersonName/);assert.match(ui,/setForm\(emptyForm\(\)\).*submissionKey\.current=""/s);assert.equal((ui.match(/filtered\.map\(\(p\) =>/g)||[]).length,2,'desktop and mobile consume the identical sorted read model');assert.match(ui,/<PendingList orders=\{pending\}/,'pending grid and list consume the same order')
assert.match(ui,/function DesktopRow[\s\S]*?<StatusControl/);assert.match(ui,/function MobileCard[\s\S]*?<StatusControl/);assert.match(ui,/<option value="Pending">Payment Pending<\/option>/);assert.match(ui,/role === "Admin" \|\| role === "Accounts"/);assert.match(ui,/Change this received receipt back to Payment Pending\?/)
const amount=require('typescript').transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/payment-amount.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,am=new Module('amount');am._compile(amount,'amount');assert.equal(am.exports.normalizePaymentAmountInput('52545'),'52545')
console.log('PASS payment rows: exact receipt, cumulative balance, status exclusions, tie-breaker, newest-first, dedupe, 52545 input and salesperson UI')
