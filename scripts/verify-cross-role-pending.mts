import assert from 'node:assert/strict'
import { pendingOrdersForUser, type Payment } from '../src/lib/payments.ts'
import type { SafeUser } from '../src/lib/auth.ts'

const user=(id:string,role:SafeUser['role'],name=id):SafeUser=>({id,name,email:`${id}@example.test`,username:id,role,active:true,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'})
const receipt=(id:string,so:string,total:number,amount:number,ownerUserId?:string,status:Payment['status']='Payment Received'):Payment=>({id,customerName:`Customer ${so}`,salesOrderId:`zoho-${so.replace(/\W/g,'')}`,salesOrderNumber:so,orderTotal:total,salesOrderDate:'2026-01-01',paymentAmount:amount,paymentDate:'2026-01-02',status,createdBy:ownerUserId||'public-salesman',ownerUserId,createdAt:`2026-01-02T00:00:0${id.slice(-1)}Z`,updatedAt:'2026-01-02T00:00:00Z'})
const admin=user('u-admin','Admin'),accounts=user('u-accounts','Accounts'),viewer=user('u-viewer','Viewer'),salesA=user('u-a','Salesperson','A'),salesB=user('u-b','Salesperson','B')
const payments=[
 receipt('p1','SO-100',100,10,salesA.id), receipt('p2','SO 100',100,90,undefined), // globally settled; partial salesperson payload used to show it
 receipt('p3','so-200',200,50,salesA.id), receipt('p4','SO200',200,25,salesB.id),
 receipt('p5','SO-300',300,25,salesB.id), receipt('p6','SO-400',400,400,salesB.id),
 receipt('p7','SO-500',500,100,salesA.id), receipt('p8','SO-500',500,400,salesA.id,'Pending'), // submitted is not settlement: still globally outstanding until confirmed
]
const ids=(rows:ReturnType<typeof pendingOrdersForUser>)=>rows.map(row=>row.salesOrderNumber.replace(/\W/g,'').toUpperCase()).sort()
const management=ids(pendingOrdersForUser(payments,admin))
assert.deepEqual(management,['SO200','SO300','SO500'])
assert.deepEqual(ids(pendingOrdersForUser(payments,accounts)),management,'Accounts must equal management union')
assert.deepEqual(ids(pendingOrdersForUser(payments,viewer)),management,'Viewer must equal management union')
assert.deepEqual(ids(pendingOrdersForUser(payments,salesA)),['SO200','SO500'],'Salesperson A gets only owned orders with global arithmetic')
assert.deepEqual(ids(pendingOrdersForUser(payments,salesB)),['SO200','SO300'],'Salesperson B gets only owned orders with global arithmetic')
assert.ok(!ids(pendingOrdersForUser(payments,salesA)).includes('SO100'),'globally settled order cannot survive role filtering')
const shared=pendingOrdersForUser(payments,salesA).find(row=>row.salesOrderNumber.replace(/\W/g,'').toUpperCase()==='SO200')!
assert.deepEqual({received:shared.received,submitted:shared.submittedAmount,outstanding:shared.outstanding},{received:75,submitted:75,outstanding:125})
const pendingOnly=pendingOrdersForUser(payments,salesA).find(row=>row.salesOrderNumber==='SO-500')!
assert.deepEqual({received:pendingOnly.received,submitted:pendingOnly.submittedAmount,outstanding:pendingOnly.outstanding,provisional:pendingOnly.provisionalOutstanding},{received:100,submitted:500,outstanding:400,provisional:0})
console.log('cross-role pending union/subset/isolation verification passed')
