import assert from 'node:assert/strict'
import { salespersonOwnsOrder } from '../src/lib/salesperson-overview'
import type { StoredPaymentOrder, PaymentOrderSuggestion } from '../src/lib/payment-order-search'
import type { SafeUser } from '../src/lib/auth'

const ram:SafeUser={id:'u-sales2',name:'Ram',email:'ram@bsm.local',username:'ram',role:'Salesperson',active:true,createdAt:'',updatedAt:''}
const base={id:'zoho-so-07769',salesOrderNumber:'SO-07769',customerName:'Regression Customer',status:'open',orderDate:'2026-10-01',orderTotal:95270,currency:'INR',modifiedTime:'2026-10-14T00:00:00Z'}

// The historical index row can legitimately predate owner ingestion. It must
// neither reject nor authorize once a successful live detail read supersedes it.
const ownerlessMirror:StoredPaymentOrder={...base}
const liveRam:PaymentOrderSuggestion={...base,rawStatus:'open',status:'Open',total:95270,salespersonName:'Ram Kumar'}
assert.equal(salespersonOwnsOrder(ownerlessMirror,ram),false,'ownerless fallback remains fail-closed')
assert.equal(salespersonOwnsOrder(liveRam,ram),true,'canonical live Ram Kumar owner authorizes u-sales2 alias')

const liveOther={...liveRam,salespersonName:'Deepak Kumar'}
assert.equal(salespersonOwnsOrder(liveOther,ram),false,'a different canonical salesperson is rejected')

// Client owner fields are intentionally not part of the authoritative order.
const forgedClient={ownerUserId:'u-sales2',salespersonName:'Ram Kumar',addedBy:'Ram Kumar'}
void forgedClient
assert.equal(salespersonOwnsOrder(liveOther,ram),false,'client-forged ownership cannot override canonical Zoho ownership')
console.log('PASS linked-payment ownership uses exact canonical live owner and fail-closed fallback')