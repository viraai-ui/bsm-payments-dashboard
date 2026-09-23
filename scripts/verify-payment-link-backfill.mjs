import assert from 'node:assert/strict'
import { buildBackfill, assertSafeMutation, normalizeSalesOrderNumber } from './payment-link-backfill-lib.mjs'
const payment=(overrides={})=>({id:'p1',customerName:' Acme  Pvt Ltd ',salesOrderNumber:' so-1 ',paymentAmount:120,status:'Payment Received',paymentDate:'2026-01-02',attachments:[{id:'proof'}],remarks:'keep',...overrides})
const order=(overrides={})=>({id:'z1',salesOrderNumber:'SO-1',customerName:'Acme Pvt Ltd',orderTotal:100,orderDate:'2025-12-01',...overrides})

assert.equal(normalizeSalesOrderNumber(' so-1 '),'SO-1')
const source={payments:[payment()]}, result=buildBackfill(source,[order()])
assert.deepEqual(source.payments[0],payment(),'input is not mutated')
assert.deepEqual({...result.output.payments[0]},{...payment(),customerName:'Acme Pvt Ltd',salesOrderId:'z1',salesOrderNumber:'SO-1',orderTotal:100,salesOrderDate:'2025-12-01'})
assert.equal(result.report.changed,1);assert.equal(result.report.customerCanonicalized,1);assert.equal(result.report.aggregateConflicts.length,1)
assert.equal(buildBackfill(result.output,[order()]).report.changed,0,'idempotent')

const conflict=buildBackfill({payments:[payment({customerName:'Different Company'})]},[order()])
assert.equal(conflict.output.payments[0].customerName,'Different Company','customer conflicts are not reassigned')
assert.equal(conflict.report.customerConflicts.length,1)
assert.equal(conflict.output.payments[0].salesOrderId,'z1','safe enrichment still occurs despite customer conflict')

const ambiguous=buildBackfill({payments:[payment()]},[order(),order({id:'z2',salesOrderNumber:' so-1 '})])
assert.equal(ambiguous.output.payments[0].salesOrderId,undefined);assert.equal(ambiguous.report.ambiguous,1)
const unlinked=buildBackfill({payments:[payment({salesOrderNumber:undefined})]},[order()])
assert.equal(unlinked.report.unlinkedWithoutNumber,1);assert.equal(unlinked.report.changed,0)

assert.throws(()=>assertSafeMutation({payments:[payment()]},{payments:[payment({paymentAmount:121})]}),/Protected field/)
assert.throws(()=>assertSafeMutation({payments:[payment()]},{payments:[]}),/count changed/)
console.log('payment-link backfill verification passed')
