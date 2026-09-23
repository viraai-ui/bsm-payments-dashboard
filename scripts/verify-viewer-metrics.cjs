const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),Module=require('node:module'),path=require('node:path')
const file=path.join(__dirname,'../src/lib/viewer-payment-metrics.ts'),source=fs.readFileSync(file,'utf8'),js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,m=new Module(file,module);m.filename=file;m.paths=module.paths;m._compile(js,file)
const now=new Date(2026,8,9,12),base={customerName:'x',createdBy:'u',createdAt:'2026-09-01T00:00:00'}
const p=(id,status,amount,paymentDate,createdAt)=>({...base,id,status,paymentAmount:amount,paymentDate,createdAt:createdAt||`${paymentDate}T08:00:00`})
const rows=[
 p('mon','Payment Received',100,'2026-09-07'),p('today-received','Payment Received',250,'2026-09-09'),
 p('today-pending','Pending',75,'2026-09-09'),p('today-unauth','Unauthorised',25,'2026-09-09'),p('today-void','Void',999,'2026-09-09'),
 p('old-pending','Pending',50,'2026-08-01'),p('month','Payment Received',30,'2026-09-01'),
 p('prior-month','Payment Received',40,'2026-08-31'),p('future','Payment Received',888,'2026-09-10')]
const result=m.exports.viewerPaymentMetrics(rows,now)
assert.deepEqual(result.map(x=>x.label),['Payment Received Today','Pending Payments','Payments Received This Week','Payments Received This Month'])
assert.deepEqual(result.map(x=>[x.amount,x.count]),[[350,3],[125,2],[350,2],[380,3]])
assert.equal(m.exports.localDateKey('2026-09-09'),'2026-09-09')
const day=m.exports.receivedPaymentsByPeriod(rows,'day',now),week=m.exports.receivedPaymentsByPeriod(rows,'week',now),month=m.exports.receivedPaymentsByPeriod(rows,'month',now)
assert.deepEqual([day.amountPaise,day.count],[25000,1],'day includes received status only')
assert.deepEqual([week.amountPaise,week.count],[35000,2],'week is Monday through today')
assert.deepEqual([month.amountPaise,month.count],[38000,3],'month is month start through today')
const cents=m.exports.receivedPaymentsByPeriod([p('cents-a','Payment Received',0.1,'2026-09-09'),p('cents-b','Payment Received',0.2,'2026-09-09')],'day',now)
assert.equal(cents.amountPaise,30,'sum is paise-safe')
assert.equal(m.exports.receivedPaymentsByPeriod([p('fallback','Payment Received',12.34,'','2026-09-09T23:00:00')],'day',now).amountPaise,1234,'createdAt fallback')
console.log('PASS Viewer metrics and Boss periods: received-only day/week/month, local boundaries, future exclusion, createdAt fallback, paise-safe sums')
