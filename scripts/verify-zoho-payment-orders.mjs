import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm,writeFile,mkdir} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// local-store resolves its local data directory at module initialization. Set
// the cwd and backend before importing any application module so this test can
// never read or mutate .env.local's production durable store.
const originalCwd=process.cwd(),root=await mkdtemp(path.join(os.tmpdir(),'bsm-zoho-orders-'))
process.chdir(root)
Object.assign(process.env,{APP_LOCAL_ONLY:'true',NODE_ENV:'test',ZOHO_CLIENT_ID:'test-client',ZOHO_CLIENT_SECRET:'test-secret',ZOHO_REFRESH_TOKEN:'test-refresh',ZOHO_ORGANIZATION_ID:'test-org',ZOHO_DC:'in'})
await mkdir(path.join(root,'data'),{recursive:true})
const { fetchAllZohoPaymentOrders, fetchZohoPaymentOrderDetail, mapZohoPaymentOrder, resetZohoPaymentOrdersForTests, searchZohoPaymentOrders } = await import('../src/lib/zoho-payment-orders.ts')
const { paymentOrderStatus, filterPaymentOrderSuggestions, normalizePaymentOrderSearch, rankPaymentOrderSuggestions } = await import('../src/lib/payment-order-lookup.ts')
const {searchPaymentOrders,synchronizePaymentOrderIndex}=await import('../src/lib/payment-order-search.ts')
const {recordZohoFailure,recordZohoSuccess,zohoCircuitStatus}=await import('../src/lib/zoho-circuit.ts')
const statuses=['draft','confirmed','open','overdue','partially_invoiced','partially_shipped','invoiced','closed','void','cancelled']
const row=(i,status=statuses[i%statuses.length],total=i+.5)=>({salesorder_id:`id-${i}`,salesorder_number:`SO-${String(i).padStart(5,'0')}`,customer_name:`Customer ${i}`,total,date:`2026-09-${String(1+i%15).padStart(2,'0')}`,status,currency_code:'INR'})
let tokenCalls=0,listCalls=0,retried=false
const mockedFetch=async input=>{const url=String(input);if(url.includes('/oauth/v2/token')){tokenCalls++;return Response.json({access_token:`token-${tokenCalls}`,expires_in:3600})}
 if(url.includes('/salesorders/id-missing'))return Response.json({salesorder:row('missing','confirmed','1,234.50')})
 listCalls++;const page=Number(new URL(url).searchParams.get('page'));assert.equal(new URL(url).searchParams.has('filter_by'),false)
 if(!retried){retried=true;return Response.json({message:'throttle'},{status:429,headers:{'retry-after':'0'}})}
 if(page===1)return Response.json({salesorders:Array.from({length:200},(_,i)=>row(i)),page_context:{page:1,has_more_page:true}})
 return Response.json({salesorders:[row(200),row(201),row(10,'closed')],page_context:{page:2,has_more_page:false}})}
resetZohoPaymentOrdersForTests();await assert.rejects(()=>fetchAllZohoPaymentOrders(mockedFetch),/throttle/)
assert.equal(listCalls,1,'429 is a hard stop and is never retried in-request')
await recordZohoSuccess();retried=true;const orders=await fetchAllZohoPaymentOrders(mockedFetch)
assert.equal(orders.length,202);assert.equal(tokenCalls,1);assert.equal(listCalls,3)
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

// Legacy migration and local search must perform no Zoho call.
const indexFile=path.join(root,'data/payment-order-index.json'),legacyAt='2026-09-20T10:00:00.000Z'
await writeFile(indexFile,JSON.stringify({version:1,updatedAt:legacyAt,orders:[{id:'legacy',salesOrderNumber:'SO-LEGACY',customerName:'Legacy Customer',status:'confirmed',orderDate:'2026-09-20',orderTotal:50},{id:'manual-index-2',salesOrderNumber:'SO INDEX 2',customerName:'Temporary screenshot row',status:'confirmed',orderDate:'2026-09-20',orderTotal:1}]}))
let networkCalls=0
const local=await searchPaymentOrders('legacy',10);assert.equal(local.orders[0].id,'legacy');assert.equal(networkCalls,0,'local index search makes zero Zoho calls')

// Checkpoint a backfill, resume it, then run/resume an overlapping delta.
resetZohoPaymentOrdersForTests();await recordZohoSuccess()
const times=['2026-09-21T10:00:00.000Z','2026-09-22T10:00:00.000Z','2026-09-23T10:00:00.000Z']
let phase='backfill',deltaSince=[]
const indexFetch=async input=>{networkCalls++;const url=String(input);if(url.includes('/oauth/'))return Response.json({access_token:'index-token',expires_in:3600})
 const parsed=new URL(url),page=Number(parsed.searchParams.get('page'));if(parsed.searchParams.has('last_modified_time'))deltaSince.push(parsed.searchParams.get('last_modified_time'))
 const item=(id,modified,total)=>({...row(id,'confirmed',total),salesorder_id:`index-${id}`,salesorder_number:`SO-INDEX-${id}`,last_modified_time:modified})
 if(phase==='backfill')return Response.json({salesorders:page===1?[item(1,times[0],10)]:[item(2,times[1],20)],page_context:{page,has_more_page:page===1}})
 return Response.json({salesorders:page===1?[item(2,times[2],25)]:[item(3,times[2],30)],page_context:{page,has_more_page:page===1}})}
let result=await synchronizePaymentOrderIndex({maxPages:1,fetcher:indexFetch});assert.equal(result.complete,false);assert.equal(result.page,2);assert.equal(result.mode,'backfill')
result=await synchronizePaymentOrderIndex({maxPages:1,fetcher:indexFetch});assert.equal(result.complete,true);assert.equal(result.indexedCount,3,'legacy and resumed backfill rows retained')
phase='delta';result=await synchronizePaymentOrderIndex({maxPages:1,fetcher:indexFetch});assert.equal(result.mode,'delta');assert.equal(result.page,2)
result=await synchronizePaymentOrderIndex({maxPages:1,fetcher:indexFetch});assert.equal(result.mode,'ready');assert.equal(result.indexedCount,4);const canonical=(await searchPaymentOrders('SO-INDEX-2',50)).orders.filter(o=>o.salesOrderNumber==='SO-INDEX-2');assert.equal(canonical.length,1,'Zoho row replaces canonical-number manual row');assert.equal(canonical[0].id,'index-2');assert.equal(canonical[0].orderTotal,25)
assert.ok(deltaSince.length===2&&deltaSince.every(value=>value===deltaSince[0]),'delta resume preserves one overlapping watermark')
assert.ok(Date.parse(deltaSince[0])<Date.parse(times[1]),'delta watermark overlaps the high watermark')

// Backfill ignores a caller's larger page budget and completed history never
// restarts page 1 without a modified-time delta filter.
await writeFile(indexFile,JSON.stringify({version:2,updatedAt:'',orders:{},state:{schema:2,mode:'backfill',nextPage:1,perPage:200,startedAt:'',completedAt:'',highWatermark:'',lastSuccessfulSync:'',nextEligibleAt:'',failureClass:'',failureCount:0,pagesProcessed:0,rowsSeen:0}}))
phase='backfill';const beforeBudget=networkCalls;result=await synchronizePaymentOrderIndex({maxPages:10,fetcher:indexFetch});assert.equal(networkCalls-beforeBudget,1,'history has a hard one-page/run budget');assert.equal(result.page,2)
await synchronizePaymentOrderIndex({maxPages:10,fetcher:indexFetch});phase='delta';const beforeReady=networkCalls;await synchronizePaymentOrderIndex({maxPages:1,fetcher:indexFetch});assert.equal(networkCalls-beforeReady,1);assert.ok(deltaSince.at(-1),'completed history only issues modified-time delta calls')

// Durable circuit prevents all calls, and leases are released even on the
// early backoff return. Future leases block; expired leases are recoverable.
const failureAt=new Date('2030-01-01T00:00:00.000Z');await recordZohoFailure(429,'quota exceeded',3600,failureAt)
let forbiddenCalls=0;result=await synchronizePaymentOrderIndex({fetcher:async()=>{forbiddenCalls++;throw new Error('must not call')}})
assert.equal(result.mode,'backoff');assert.equal(result.callsThisRun,0);assert.equal(forbiddenCalls,0)
let persisted=JSON.parse(await readFile(indexFile,'utf8'));assert.equal(persisted.state.lease,undefined,'backoff releases lease')
await recordZohoSuccess(new Date('2030-01-01T02:00:00.000Z'))
persisted.state.lease={id:'other-worker',expiresAt:new Date(Date.now()+60_000).toISOString()};await writeFile(indexFile,JSON.stringify(persisted))
result=await synchronizePaymentOrderIndex({fetcher:indexFetch});assert.equal(result.callsThisRun,0);assert.equal(result.error,'lease-active')
persisted=JSON.parse(await readFile(indexFile,'utf8'));persisted.state.lease.expiresAt=new Date(Date.now()-1).toISOString();await writeFile(indexFile,JSON.stringify(persisted))
result=await synchronizePaymentOrderIndex({maxPages:1,fetcher:indexFetch});assert.ok(result.callsThisRun>0,'expired lease is reclaimed')
persisted=JSON.parse(await readFile(indexFile,'utf8'));assert.equal(persisted.state.lease,undefined,'recovered run releases lease')
assert.equal((await zohoCircuitStatus()).failureCount,0)

process.chdir(originalCwd);await rm(root,{recursive:true,force:true})
console.log(`Zoho payment lookup/index verified in isolated ${path.basename(root)}: migration, checkpoint/resume, delta watermark, zero-call search, circuit backoff and lease recovery passed`)
