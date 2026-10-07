import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseLinkedPaymentSplit } from '../src/lib/payment-domain.ts'
import { orderSummary, paymentOutstandingById, soPaymentAmount } from '../src/lib/payment-settlement.ts'
import { paymentEvent } from '../src/lib/payouts-outbox.ts'

const split=parseLinkedPaymentSplit({paymentAmount:'27000',expenseAmount:'2000',expenseName:'Freight'})
assert.equal(split.ok,true)
if(split.ok) assert.deepEqual(split.value,{paymentAmount:27000,expenseAmount:2000,expenseName:'Freight',soPaymentAmount:25000})
assert.equal(parseLinkedPaymentSplit({paymentAmount:'100',expenseAmount:'100',expenseName:'fee'}).ok,false)
assert.equal(parseLinkedPaymentSplit({paymentAmount:'100',expenseAmount:'1'}).ok,false)
assert.equal(parseLinkedPaymentSplit({paymentAmount:'100',expenseAmount:'101',expenseName:'fee'}).ok,false)
const base={customerName:'Acme',salesOrderNumber:'SO-1',salesOrderId:'so1',orderTotal:50000,status:'Payment Received' as const,createdAt:'2026-01-01',paymentDate:'2026-01-01'}
const first={...base,id:'p1',paymentAmount:27000,expenseAmount:2000,expenseName:'Freight'}
assert.equal(soPaymentAmount(first),25000)
assert.equal(orderSummary([first],'SO-1',50000,'so1').outstanding,25000)
assert.equal(paymentOutstandingById([first]).get('p1'),25000)
const exact={...base,id:'p2',paymentAmount:52000,expenseAmount:2000}
assert.equal(orderSummary([exact],'SO-1',50000,'so1').outstanding,0)
const wire=paymentEvent({...first,createdBy:'u',updatedAt:'2026-01-01T00:00:00Z'} as any,'received',{id:'so1',salesOrderNumber:'SO-1',customerName:'Acme'})
assert.equal(wire.payment.amount,'25000.00')
const ui=readFileSync(new URL('../src/components/PaymentsClient.tsx',import.meta.url),'utf8')
assert.match(ui,/Add \{money\(Number\(form\.paymentAmount\)-Number\(form\.provisionalOutstanding\)\)\} as expense/)
assert.match(ui,/aria-controls="new-payment-expense-fields"/)
assert.match(ui,/: "Total received"\}<\/dt>/)
assert.match(ui,/className="mobile-expense-line"/)
assert.match(ui,/p\.expenseName \|\| "Expense"/)
const css=readFileSync(new URL('../src/app/payments-cleanup.css',import.meta.url),'utf8')
assert.match(css,/\.mobile-expense-line\{[^}]*width:100%/)
assert.match(css,/\.expense-toggle\{min-height:44px\}/)
console.log('linked payment expense split verified')
