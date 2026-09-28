import assert from 'node:assert/strict'
import { selectSalespersonOverview } from '../src/lib/salesperson-overview'
import type { SafeUser } from '../src/lib/auth'
import type { Payment } from '../src/lib/payments'
import type { StoredPaymentOrder } from '../src/lib/payment-order-search'
const user=(id:string,name:string):SafeUser=>({id,name,email:`${name}@example.com`,username:name.toLowerCase(),role:'Salesperson',active:true,createdAt:'',updatedAt:''})
const a=user('a','Alice'),b=user('b','Bob'),orders:StoredPaymentOrder[]=[
 {id:'1',salesOrderNumber:'SO-1',customerName:'One',status:'open',orderDate:'2026-09-03',orderTotal:100,currency:'INR',modifiedTime:'',salespersonEmail:a.email},
 {id:'2',salesOrderNumber:'SO-2',customerName:'Two',status:'closed',orderDate:'2026-09-02',orderTotal:100,currency:'INR',modifiedTime:'',salespersonName:a.name},
 {id:'3',salesOrderNumber:'SO-3',customerName:'Three',status:'open',orderDate:'2026-09-01',orderTotal:100,currency:'INR',modifiedTime:'',salespersonId:b.id},
 {id:'4',salesOrderNumber:'SO-4',customerName:'Four',status:'open',orderDate:'2026-09-04',orderTotal:0,currency:'INR',modifiedTime:'',salespersonId:a.id},
]
const payment=(id:string,so:string,amount:number,status:Payment['status'],owner='a',extra:Partial<Payment>={}):Payment=>({id,customerName:'x',salesOrderId:so.replace('SO-',''),salesOrderNumber:so,orderTotal:100,paymentAmount:amount,paymentDate:'2026-09-01',status,createdBy:owner,ownerUserId:owner,createdAt:'2026-09-01',updatedAt:'2026-09-01',audit:[],...extra})
const payments=[payment('p1','SO-2',30,'Payment Received'),payment('p2','SO-2',70,'Pending'),payment('void','SO-2',100,'Void'),payment('unauth','SO-1',100,'Unauthorised')]
let model=selectSalespersonOverview(orders,payments,a,{lastSyncedAt:'2026-09-04T00:00:00Z',recencyVerifiedAt:''},new Date('2026-09-04T00:00:05Z'))
assert.deepEqual(model.orders.map(x=>x.salesOrderId),['1','2','4']);assert.deepEqual(model.orders.map(x=>x.status),['NO_PAYMENT','PENDING','RECEIVED']);assert.equal(model.orders[1].received,30);assert.equal(model.metrics.total,model.orders.length);assert.equal(model.mirror.freshnessSeconds,5)
model=selectSalespersonOverview(orders,[...payments,payment('p3','SO-2',70,'Payment Received')],a,{lastSyncedAt:'',recencyVerifiedAt:''})
assert.equal(model.orders.find(x=>x.salesOrderId==='2')?.status,'RECEIVED')
assert.deepEqual(selectSalespersonOverview(orders,payments,b,{lastSyncedAt:'',recencyVerifiedAt:''}).orders.map(x=>x.salesOrderId),['3'])
const conflictingPayment=payment('conflict','SO-3',10,'Pending','a')
assert.deepEqual(selectSalespersonOverview(orders,[...payments,conflictingPayment],a,{lastSyncedAt:'',recencyVerifiedAt:''}).orders.map(x=>x.salesOrderId),['1','2','4'],'an owned payment must not override an explicit ERP owner')
const collisionOrders=[...orders,{...orders[0],id:'duplicate',salespersonEmail:undefined,salespersonName:undefined,salespersonId:undefined}]
const legacyNumberOnly={...payment('legacy','SO-1',100,'Payment Received','a'),salesOrderId:undefined}
assert.equal(selectSalespersonOverview(collisionOrders,[legacyNumberOnly],a,{lastSyncedAt:'',recencyVerifiedAt:''}).orders.find(x=>x.salesOrderId==='1')?.status,'NO_PAYMENT','ambiguous number-only receipt must not attach to either duplicate order')
assert.equal(selectSalespersonOverview(orders,[{...legacyNumberOnly,salesOrderId:'wrong-id'}],a,{lastSyncedAt:'',recencyVerifiedAt:''}).orders.find(x=>x.salesOrderId==='1')?.status,'NO_PAYMENT','a conflicting immutable ID must never fall back to SO number')
console.log('salesperson overview: role isolation, explicit ERP ownership precedence, status transitions, exclusions, zero-total and shared metrics/list selector passed')
