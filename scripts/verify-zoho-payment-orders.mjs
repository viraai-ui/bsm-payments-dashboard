import assert from 'node:assert/strict'
import { fetchAllZohoPaymentOrders, fetchZohoPaymentOrderDetail, mapZohoPaymentOrder, resetZohoPaymentOrdersForTests, searchZohoPaymentOrders } from '../src/lib/zoho-payment-orders.ts'
import { paymentOrderStatus, filterPaymentOrderSuggestions, normalizePaymentOrderSearch, rankPaymentOrderSuggestions } from '../src/lib/payment-order-lookup.ts'
Object.assign(process.env,{ZOHO_CLIENT_ID:'test-client',ZOHO_CLIENT_SECRET:'test-secret',ZOHO_REFRESH_TOKEN:'test-refresh',ZOHO_ORGANIZATION_ID:'test-org',ZOHO_DC:'in'})
const statuses=['draft','confirmed','open','overdue','partially_invoiced','partially_shipped','invoiced','closed','void','cancelled']
const row=(i,status=statuses[i%statuses.length],total=i+.5)=>({salesorder_id:`id-${i}`,salesorder_number:`SO-${String(i).padStart(5,'0')}`,customer_name:`Customer ${i}`,total,date:`2026-09-${String(1+i%15).padStart(2,'0')}`,status,currency_code:'INR'})
let tokenCalls=0,listCalls=0,retried=false
const mockedFetch=async input=>{const url=String(input);if(url.includes('/oauth/v2/token')){tokenCalls++;return Response.json({access_token:`token-${tokenCalls}`,expires_in:3600})}
 if(url.includes('/salesorders/id-missing'))return Response.json({salesorder:row('missing','confirmed','1,234.50')})
 listCalls++;const page=Number(new URL(url).searchParams.get('page'));assert.equal(new URL(url).searchParams.has('filter_by'),false)
 if(!retried){retried=true;return Response.json({message:'throttle'},{status:429,headers:{'retry-after':'0'}})}
 if(page===1)return Response.json({salesorders:Array.from({length:200},(_,i)=>row(i)),page_context:{page:1,has_more_page:true}})
 return Response.json({salesorders:[row(200),row(201),row(10,'closed')],page_context:{page:2,has_more_page:false}})}
resetZohoPaymentOrdersForTests();const orders=await fetchAllZohoPaymentOrders(mockedFetch)
assert.equal(orders.length,202);assert.equal(tokenCalls,1);assert.ok(listCalls>=3,'429 is retried')
for(const status of statuses)assert.ok(orders.some(o=>o.rawStatus===status),`retains ${status}`)
assert.equal(mapZohoPaymentOrder(row(1,'closed','1,234.50'))?.total,1234.5)
assert.equal(mapZohoPaymentOrder(row(2,'confirmed',0))?.orderTotal,0)
assert.equal(mapZohoPaymentOrder({...row(3),total:'not money'}),null)
assert.notEqual(paymentOrderStatus('not_invoiced'),'Closed');assert.equal(paymentOrderStatus('partially_invoiced'),'Open');assert.equal(paymentOrderStatus('closed'),'Closed')
const searchable=orders.map(o=>({...o,status:paymentOrderStatus(o.rawStatus)}));assert.ok(filterPaymentOrderSuggestions(searchable,'2',50).length);assert.ok(filterPaymentOrderSuggestions(searchable,'Customer 1',50).length)
assert.equal(normalizePaymentOrderSearch(' SO - 07 987 '),'so07987')
const ranked=rankPaymentOrderSuggestions([
  {id:'customer',salesOrderNumber:'SO-10000',customerName:'07987 Shoes',status:'Open',rawStatus:'confirmed'},
  {id:'partial',salesOrderNumber:'SO-079870',customerName:'Other',status:'Closed',rawStatus:'closed'},
  {id:'exact',salesOrderNumber:'SO-07987',customerName:'Historical Closed Co',status:'Closed',rawStatus:'invoiced'},
  {id:'exact',salesOrderNumber:'SO-07987',customerName:'duplicate alias',status:'Open',rawStatus:'confirmed'},
],' 07987 ',10)
assert.deepEqual(ranked.map(order=>order.id),['exact','partial','customer'],'exact normalized SO ranks first and ids dedupe')
resetZohoPaymentOrdersForTests();let detailCalls=0
const missingTotalFetch=async input=>{const url=String(input);if(url.includes('/oauth/'))return Response.json({access_token:'token',expires_in:3600});if(url.includes('/salesorders/id-1')){detailCalls++;return Response.json({salesorder:row(1,'confirmed','9,876.50')})}return Response.json({salesorders:[{...row(1),total:undefined}],page_context:{page:1,has_more_page:false}})}
const hydrated=await searchZohoPaymentOrders('SO-00001',10,missingTotalFetch);assert.equal(hydrated[0].total,9876.5);assert.equal(hydrated[0].orderTotal,9876.5);assert.equal(detailCalls,1,'missing list total detail-hydrated once')
assert.equal((await fetchZohoPaymentOrderDetail('id-1',missingTotalFetch)).total,9876.5);assert.equal(detailCalls,1,'detail is cached')
console.log(`Zoho payment lookup verified: ${orders.length} unique orders; all statuses, retry, dedupe, totals and detail hydration passed`)
