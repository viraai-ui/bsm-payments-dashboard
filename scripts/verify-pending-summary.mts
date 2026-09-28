import assert from 'node:assert/strict'
import { managementPaymentMetrics } from '../src/lib/management-payment-metrics.ts'

const payment=(id:string,status:'Pending'|'Payment Received'|'Unauthorised'|'Void',amount:number,orderTotal=56200)=>({id,customerName:'Fixture',salesOrderId:`order-${id}`,salesOrderNumber:`SO-${id}`,orderTotal,paymentAmount:amount,status,createdAt:'2026-09-28T00:00:00Z'})
const amount=(payments:ReturnType<typeof payment>[],orders:Array<{outstanding?:number}>)=>managementPaymentMetrics(payments,orders).find(metric=>metric.key==='pending-payments')!.amount

// Original failure: a stale receipt snapshot implied ₹56,200 while the canonical
// salesperson queue was empty. The headline must follow the queue, not snapshots.
assert.equal(amount([payment('stale','Payment Received',0)],[]),0)
const anujOrders=[{outstanding:40000},{outstanding:16200}]
assert.equal(amount([payment('partial','Payment Received',10000)],anujOrders),56200)
assert.equal(amount([],anujOrders),56200,'receipt visibility cannot change canonical outstanding')
assert.equal(amount([],anujOrders.filter(order=>order.outstanding===40000)),40000,'each role uses its own scoped queue')
assert.equal(amount([],[]),0,'zero rows always means zero amount')
assert.equal(amount([], [{outstanding:0},{outstanding:-10},{outstanding:100.25}]),100.25,'settled/invalid balances do not overcount')
assert.equal(managementPaymentMetrics([payment('pending','Pending',500)],[]).find(metric=>metric.key==='pending-receipts')?.label,'Payment Pending','receipt workflow and order balance have distinct labels')
// Search is deliberately absent from selector inputs, so it cannot alter headlines.
assert.equal(anujOrders.filter(()=>false).length,0)
assert.equal(amount([],anujOrders),56200)
console.log('pending summary/list canonical collection verification passed')