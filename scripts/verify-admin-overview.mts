import assert from 'node:assert/strict'
import fs from 'node:fs'
import {adminOverviewMetrics} from '../src/lib/admin-overview-metrics'
import type {Payment} from '../src/lib/payments'
const base={customerName:'Acme',createdBy:'u',createdAt:'2026-10-07T08:00:00Z',updatedAt:'2026-10-07T08:00:00Z',paymentDate:'2026-10-07'}
const p=(id:string,status:Payment['status'],paymentAmount:number,extra:Partial<Payment>={}):Payment=>({...base,id,status,paymentAmount,...extra})
const rows=[
 p('linked','Payment Received',110,{salesOrderNumber:'SO-1',expenseAmount:10,salespersonName:'A'}),
 p('pending-receipt','Pending',50,{salesOrderNumber:'SO-2',expenseAmount:5,salespersonName:'B'}),
 p('parent','Unauthorised',200,{originalPaymentAmount:200,remainingAmount:120}),
 p('child','Payment Received',80,{parentPaymentId:'parent',salesOrderNumber:'SO-3',salespersonName:'A'}),
 p('exhausted-parent','Unauthorised',300,{originalPaymentAmount:300,remainingAmount:0,closedRemainderAmount:20}),
 p('exhausted-child','Payment Received',280,{parentPaymentId:'exhausted-parent',salesOrderNumber:'SO-4',salespersonName:'A'}),
 p('closed-parent','Unauthorised',75,{originalPaymentAmount:75,remainingAmount:0,closedRemainderAmount:75}),
 p('void','Void',999),
]
const openOrders=[{outstanding:300},{outstanding:125},{outstanding:0}]
const metric=adminOverviewMetrics(rows,openOrders,'day',new Date(2026,9,7,12))
assert.deepEqual(metric.cash,{amountPaise:73500,count:5},'cash counts each non-void root bank receipt once, never allocation children')
assert.deepEqual(metric.pending,{amountPaise:42500,count:2},'Pending uses positive open-order outstanding, not Pending receipt rows')
assert.deepEqual(metric.unauthorised,{amountPaise:12000,count:1},'Unauthorised uses only actionable roots and their remaining amount')
assert.equal(metric.expenses.amountPaise,1500)
assert.deepEqual(metric.salespeople.map(x=>[x.name,x.amountPaise]),[['A',46000],['B',4500]],'salesperson credit excludes expenses and includes allocated children exactly once')
assert.equal(metric.buckets.at(-1)?.amountPaise,73500)
assert.deepEqual(metric.composition,[
 {status:'Received receipts',amountPaise:11000,count:1},
 {status:'Pending orders',amountPaise:42500,count:2},
 {status:'Unauthorised remaining',amountPaise:12000,count:1},
],'donut uses the same canonical entities as the visible tabs and omits exhausted parents')
const page=fs.readFileSync(new URL('../src/app/overview/page.tsx',import.meta.url),'utf8'),shell=fs.readFileSync(new URL('../src/components/DashboardShell.tsx',import.meta.url),'utf8'),mobile=fs.readFileSync(new URL('../src/components/MobileMenu.tsx',import.meta.url),'utf8'),ui=fs.readFileSync(new URL('../src/components/AdminOverviewClient.tsx',import.meta.url),'utf8'),styles=fs.readFileSync(new URL('../src/components/admin-overview.css',import.meta.url),'utf8'),loading=fs.readFileSync(new URL('../src/app/overview/loading.tsx',import.meta.url),'utf8')
assert.match(page,/user\.role===['"]Salesperson['"]\|\|user\.role===['"]Spare Part Sales['"]/,'sales roles retain their existing overview')
assert.match(page,/user\.role!==['"]Admin['"]\)redirect\(['"]\/payments['"]\)/,'other roles cannot load Admin overview')
assert.match(page,/paymentReadModelForUserFresh\(user\)/,'route loads full authorised model server-side')
assert.match(page,/adminOverviewSummaries\(model\.payments,model\.pendingOrders\)/,'route computes compact DTOs on the authenticated server')
assert.doesNotMatch(page,/<AdminOverviewClient[^>]*(payments|pendingOrders)=/,'route never serializes the raw ledger into the client component')
assert.match(ui,/summaries:\s*AdminOverviewSummaries/,'client accepts summaries, not payments')
assert.doesNotMatch(ui,/Payment\[\]|adminOverviewMetrics|useMemo/,'client does no ledger calculation')
assert.match(shell,/\['Admin','Salesperson','Spare Part Sales'\]\.includes\(user\.role\)/,'Overview nav is limited to Admin and existing sales roles')
for(const [name,source] of [['shell',shell],['mobile',mobile],['overview',ui]] as const){assert.match(source,/import Link from ['"]next\/link['"]/,`${name} uses client navigation`);assert.doesNotMatch(source,/<a[^>]+href=[{'"]\/?(?:overview|payments|settings)/,`${name} has no hard dashboard navigation`)}
assert.match(loading,/aria-busy="true"/,'overview has an instant route loading skeleton')
for(const contract of ['Pending orders','Unauthorised remaining','aria-label="Overview period"','role="group"','aria-pressed={period === item}','role="img"','<h1>Overview</h1>'])assert.ok(ui.includes(contract),`UI contract: ${contract}`)
assert.match(styles,/\.admin-period\{[^}]*display:grid[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)[^}]*width:240px[^}]*border:1px solid/,'period selector is a compact equal-width bordered grid on desktop')
assert.match(styles,/\.admin-period button\{[^}]*min-height:44px/,'period controls retain 44px minimum touch targets')
assert.match(styles,/\.admin-period button\[aria-pressed=true\]\{[^}]*background:#a30d27[^}]*color:#fff/,'selected period uses the BSM red high-contrast state')
assert.match(styles,/@media\(max-width:760px\)[\s\S]*?\.admin-period\{width:min\(100%,228px\);justify-self:start\}/,'mobile selector stays compact from 320–430px instead of stretching into an oversized pill')
assert.doesNotMatch(styles,/\.admin-period button\[aria-pressed=true\]\{[^}]*background:#fff/,'selected period is not a raised white tile')
for(const copy of ['Payments, at a glance.','Live financial pulse','full bank receipt value','expenses excluded','admin-footnote','Confirmed balance across open orders'])assert.ok(!ui.includes(copy),`descriptive copy removed: ${copy}`)
assert.match(ui,/<desc[^>]*>Full bank receipt values over time\.<\/desc>/,'chart description remains available to assistive technology')
console.log('PASS Admin Overview: canonical pending orders/actionable unauthorised, allocation de-duplication, compact server DTOs, role gate, and accessible UI contracts')