const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),Module=require('node:module')
const file=path.join(__dirname,'../src/lib/payment-settlement.ts'),source=fs.readFileSync(file,'utf8'),js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,m=new Module(file);m.filename=file;m.paths=module.paths;m._compile(js,file)
const {paymentOutstandingById,sortPayments}=m.exports
const base={customerName:'V.S. ENTERPRISES',salesOrderId:'zoho-7976',salesOrderNumber:'SO-07976',orderTotal:53100,paymentDate:'2026-09-18'}
const p=(id,amount,status,createdAt)=>({...base,id,paymentAmount:amount,status,createdAt})
let rows=[p('first',555,'Payment Received','2026-09-18T09:00:00Z'),p('second',52545,'Pending','2026-09-18T10:00:00Z')]
let balances=paymentOutstandingById(rows);assert.equal(balances.get('first'),52545);assert.equal(balances.get('second'),0);assert.equal(rows[1].paymentAmount,52545)
assert.equal(sortPayments(rows)[0].id,'second','newest row displays latest balance')
assert.equal(paymentOutstandingById([p('only',555,'Pending','2026-09-18T09:00:00Z')]).get('only'),52545)
rows=[p('a',555,'Pending','2026-09-18T09:00:00Z'),p('b',52545,'Payment Received','2026-09-18T10:00:00Z'),p('void',900,'Void','2026-09-18T11:00:00Z'),p('unauth',900,'Unauthorised','2026-09-18T12:00:00Z')];balances=paymentOutstandingById(rows);assert.equal(balances.get('b'),0);assert.equal(balances.get('void'),0);assert.equal(balances.get('unauth'),0)
rows=[p('a',100,'Pending','2026-09-18T09:00:00Z'),p('b',200,'Pending','2026-09-18T09:00:00Z')];balances=paymentOutstandingById(rows);assert.equal(balances.get('a'),53000);assert.equal(balances.get('b'),52800)
rows=[p('same',555,'Pending','2026-09-18T09:00:00Z'),p('same',555,'Payment Received','2026-09-18T10:00:00Z')];assert.equal(paymentOutstandingById(rows).size,1)
const ui=fs.readFileSync(path.join(__dirname,'../src/components/PaymentsClient.tsx'),'utf8');assert.match(ui,/<th>Receipt<\/th>/);assert.match(ui,/<dt>Receipt<\/dt>/);assert.match(ui,/money\(p\.paymentAmount\)/);assert.match(ui,/paymentOutstandingById\(payments\)/);assert.match(ui,/salespersonName/);assert.match(ui,/setForm\(emptyForm\(\)\).*submissionKey\.current=""/s)
const amount=require('typescript').transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/payment-amount.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,am=new Module('amount');am._compile(amount,'amount');assert.equal(am.exports.normalizePaymentAmountInput('52545'),'52545')
console.log('PASS payment rows: exact receipt, cumulative balance, status exclusions, tie-breaker, newest-first, dedupe, 52545 input and salesperson UI')
