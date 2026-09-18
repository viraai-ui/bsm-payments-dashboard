// Opt-in, read-only production verification. Run: LIVE_ZOHO_VERIFY=1 node --env-file=.env.local --experimental-strip-types scripts/verify-zoho-payment-orders-live.mjs
if(process.env.LIVE_ZOHO_VERIFY!=='1'){console.log('Skipped live Zoho verification (set LIVE_ZOHO_VERIFY=1).');process.exit(0)}
const {fetchAllZohoPaymentOrders,fetchZohoPaymentOrderDetail}=await import('../src/lib/zoho-payment-orders.ts')
const orders=await fetchAllZohoPaymentOrders(),buckets={}
for(const order of orders)buckets[order.rawStatus]=(buckets[order.rawStatus]||0)+1
const known=orders.find(o=>o.salesOrderNumber==='SO-07833'),zero=orders.find(o=>o.total===0),high=[...orders].sort((a,b)=>b.total-a.total)[0],nonClosed=orders.find(o=>o.rawStatus!=='closed')
const samples=[known,zero,high,nonClosed].filter((o,i,a)=>o&&a.findIndex(x=>x.id===o.id)===i)
const comparisons=[]
for(const list of samples){const detail=await fetchZohoPaymentOrderDetail(list.id);comparisons.push({id:list.id,salesOrderNumber:list.salesOrderNumber,status:detail.rawStatus,currency:detail.currency,listTotal:list.total,detailTotal:detail.total,match:list.total===detail.total})}
console.log(JSON.stringify({count:orders.length,statusBuckets:buckets,samples:comparisons},null,2))
if(!orders.length||comparisons.some(x=>!x.match))throw new Error('Live Zoho total verification failed')
