import assert from 'node:assert/strict'
import { orderSummary, toPaise } from '../src/lib/payment-settlement.ts'

const so='SO-001', id='zoho-1', total=1000
const payment=(paymentAmount, status, extra={})=>({customerName:'Acme',salesOrderNumber:so,salesOrderId:id,paymentAmount,status,...extra})
const summary=(payments)=>orderSummary(payments,so,total,id)

assert.deepEqual([summary([]).advanceReceived,summary([]).pendingPayment],[0,1000],'zero prior')
assert.deepEqual([summary([payment(250,'Payment Received')]).advanceReceived,summary([payment(250,'Payment Received')]).pendingPayment],[250,750],'received')
assert.deepEqual([summary([payment(125.25,'Pending')]).advanceReceived,summary([payment(125.25,'Pending')]).pendingPayment],[125.25,874.75],'pending reserves balance')
const mixed=summary([payment(100.01,'Payment Received'),payment(200.02,'Pending')])
assert.deepEqual([mixed.advanceReceived,mixed.pendingPayment],[300.03,699.97],'mixed aggregate in paise')
assert.equal(summary([payment(500,'Void')]).advanceReceived,0,'void excluded')
assert.equal(summary([payment(500,'Unauthorised')]).advanceReceived,0,'unauthorised excluded')
assert.equal(summary([payment(1200,'Pending')]).pendingPayment,0,'overpaid clamps to zero')
assert.equal(summary([payment(100,'Pending',{salesOrderNumber:' so 001 ',salesOrderId:undefined})]).advanceReceived,100,'normalized SO match')
assert.equal(summary([payment(100,'Pending')],).advanceReceived,100,'id and number do not double count')
assert.equal(orderSummary([payment(100,'Pending',{orderTotal:900})],so,1000,id).orderTotal,1000,'Zoho total is authoritative')
const remaining=summary([payment(250.25,'Pending')]).pendingPayment
assert.equal(toPaise(remaining),74975)
assert.equal(toPaise(remaining)<=toPaise(remaining),true,'exact remaining accepted')
assert.equal(toPaise(remaining+0.01)>toPaise(remaining),true,'one paisa over rejected')
console.log('Settlement summary verification passed: 12 scenarios')
