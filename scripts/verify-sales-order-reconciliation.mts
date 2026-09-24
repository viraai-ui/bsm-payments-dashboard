import assert from 'node:assert/strict'
import {mkdtemp,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
process.env.APP_LOCAL_ONLY='true'
const cwd=process.cwd();process.chdir(await mkdtemp(path.join(tmpdir(),'so-reconcile-')))
const {commitSalesOrder,readSalesOrderSnapshots,applySalesOrderSnapshots}=await import('../src/lib/sales-order-reconciliation.ts')
const {pendingOrdersForUser}=await import('../src/lib/payments.ts')
const order=(total:number,modifiedTime:string,customerName='Acme Renamed')=>({id:'zoho-1',salesOrderNumber:'SO-100',customerName,total,orderTotal:total,orderDate:'2026-01-01',rawStatus:'confirmed',currency:'INR',modifiedTime})
assert.equal(await commitSalesOrder(order(1000,'2026-01-02T00:00:00+0530')),true)
assert.equal(await commitSalesOrder(order(1000,'2026-01-02T00:00:00+0530')),false,'no-change retry is idempotent')
assert.equal(await commitSalesOrder(order(900,'2026-01-03T00:00:00+0530')),true,'decrease applies')
assert.equal(await commitSalesOrder(order(1200,'2026-01-01T00:00:00+0530')),false,'stale response cannot overwrite newer data')
const base:any[]=[
 {id:'p1',customerName:'Old Acme',salesOrderId:'zoho-1',salesOrderNumber:'SO 100',orderTotal:1100,paymentAmount:500,paymentDate:'2026-01-01',status:'Payment Received',createdBy:'u-a',ownerUserId:'u-a',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'},
 {id:'p2',customerName:'Old Acme',salesOrderId:'zoho-1',salesOrderNumber:'so-100',orderTotal:1100,paymentAmount:400,paymentDate:'2026-01-02',status:'Payment Received',createdBy:'u-b',ownerUserId:'u-b',createdAt:'2026-01-02T00:00:00Z',updatedAt:'2026-01-02T00:00:00Z'}]
let projected=applySalesOrderSnapshots(base,await readSalesOrderSnapshots())
assert.deepEqual(projected.map(p=>p.paymentAmount),[500,400],'receipt amounts remain immutable')
assert.ok(projected.every(p=>p.orderTotal===900&&p.customerName==='Acme Renamed'),'canonical alias and rename project consistently')
const user=(id:string,role:string)=>({id,name:id,email:id+'@x',username:id,role,active:true,createdAt:'',updatedAt:''}) as any
for(const role of ['Admin','Accounts','Viewer'])assert.equal(pendingOrdersForUser(projected,user('management',role)).length,0,'total equal paid is settled for '+role)
assert.equal(await commitSalesOrder(order(1300,'2026-01-04T00:00:00+0530')),true,'increase applies')
projected=applySalesOrderSnapshots(base,await readSalesOrderSnapshots())
for(const role of ['Admin','Accounts','Viewer']){const rows=pendingOrdersForUser(projected,user('management',role));assert.equal(rows[0].outstanding,400);assert.equal(rows[0].received,900)}
assert.equal(pendingOrdersForUser(projected,user('u-a','Salesperson'))[0].outstanding,400,'salesperson subset uses global receipts')
assert.equal(pendingOrdersForUser(projected,user('u-none','Salesperson')).length,0)
assert.equal(await commitSalesOrder(order(800,'2026-01-05T00:00:00+0530')),true,'below-paid total applies safely')
projected=applySalesOrderSnapshots(base,await readSalesOrderSnapshots());const below=pendingOrdersForUser(projected,user('management','Admin'));assert.equal(below.length,0,'overpaid order never creates negative pending')
const durable=JSON.parse(await readFile('data/sales-order-snapshots.json','utf8'));assert.equal(durable.orders['zoho-1'].audit.length,4);assert.equal(durable.orders['zoho-1'].version,4)
process.chdir(cwd)
console.log('PASS sales-order reconciliation: decrease/increase, immutable multiple receipts, aliases, rename, stale ordering, idempotency, overpayment clamp, role union/subsets, durable audit')
