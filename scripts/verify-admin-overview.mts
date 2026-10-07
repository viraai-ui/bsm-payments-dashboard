import assert from 'node:assert/strict'
import fs from 'node:fs'
import {adminOverviewMetrics} from '../src/lib/admin-overview-metrics'
import type {Payment} from '../src/lib/payments'
const base={customerName:'Acme',createdBy:'u',createdAt:'2026-10-07T08:00:00Z',updatedAt:'2026-10-07T08:00:00Z',paymentDate:'2026-10-07'}
const p=(id:string,status:Payment['status'],paymentAmount:number,extra:Partial<Payment>={}):Payment=>({...base,id,status,paymentAmount,...extra})
const rows=[
 p('linked','Payment Received',110,{salesOrderNumber:'SO-1',expenseAmount:10,salespersonName:'A'}),
 p('pending','Pending',50,{salesOrderNumber:'SO-2',expenseAmount:5,salespersonName:'B'}),
 p('parent','Unauthorised',200,{originalPaymentAmount:200,remainingAmount:120}),
 p('child','Payment Received',80,{parentPaymentId:'parent',salesOrderNumber:'SO-3',salespersonName:'A'}),
 p('void','Void',999),
]
const metric=adminOverviewMetrics(rows,[{outstanding:300},{outstanding:0}],'day',new Date(2026,9,7,12))
assert.deepEqual(metric.cash,{amountPaise:36000,count:3},'cash counts full root bank receipts once, including expense')
assert.deepEqual(metric.pending,{amountPaise:5000,count:1})
assert.deepEqual(metric.unauthorised,{amountPaise:20000,count:1})
assert.deepEqual(metric.outstanding,{amountPaise:30000,count:1})
assert.equal(metric.expenses.amountPaise,1500)
assert.deepEqual(metric.salespeople.map(x=>[x.name,x.amountPaise]),[['A',18000],['B',4500]],'salesperson credit excludes expenses and includes allocated child')
assert.equal(metric.buckets.at(-1)?.amountPaise,36000)
const page=fs.readFileSync(new URL('../src/app/overview/page.tsx',import.meta.url),'utf8'),shell=fs.readFileSync(new URL('../src/components/DashboardShell.tsx',import.meta.url),'utf8'),ui=fs.readFileSync(new URL('../src/components/AdminOverviewClient.tsx',import.meta.url),'utf8')
assert.match(page,/user\.role===['"]Salesperson['"]\|\|user\.role===['"]Spare Part Sales['"]/,'sales roles retain their existing overview')
assert.match(page,/user\.role!==['"]Admin['"]\)redirect\(['"]\/payments['"]\)/,'other roles cannot load Admin overview')
assert.match(page,/paymentReadModelForUserFresh\(user\)/,'route loads full authorised model server-side')
assert.match(shell,/\['Admin','Salesperson','Spare Part Sales'\]\.includes\(user\.role\)/,'Overview nav is limited to Admin and existing sales roles')
for(const contract of ['Order outstanding','aria-label="Overview period"','role="img"','<h1>Overview</h1>'])assert.ok(ui.includes(contract),`UI contract: ${contract}`)
for(const copy of ['Payments, at a glance.','Live financial pulse','full bank receipt value','expenses excluded','admin-footnote','Confirmed balance across open orders'])assert.ok(!ui.includes(copy),`descriptive copy removed: ${copy}`)
assert.match(ui,/<desc[^>]*>Full bank receipt values over time\.<\/desc>/,'chart description remains available to assistive technology')
console.log('PASS Admin Overview: full-ledger cash, expense-safe SO credit, outstanding, allocation de-duplication, server role gate, nav gate, clean UI, and accessible chart contracts')