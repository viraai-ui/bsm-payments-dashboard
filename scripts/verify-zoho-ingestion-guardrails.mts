import assert from 'node:assert/strict'
import {readFile,writeFile,unlink} from 'node:fs/promises'
process.env.APP_LOCAL_ONLY='true'
const path='data/zoho-daily-budget.json',prior=await readFile(path,'utf8').catch(()=>null)
try{
 const {istBudgetWindow,reserveZohoBusinessCall,PAYMENT_ZOHO_DAILY_LIMIT}=await import('../src/lib/zoho-budget.ts')
 assert.equal(istBudgetWindow(new Date('2026-09-29T18:29:59Z')).day,'2026-09-29')
 assert.deepEqual(istBudgetWindow(new Date('2026-09-29T18:30:00Z')),{day:'2026-09-30',nextResetAt:'2026-09-30T18:30:00.000Z'})
 await writeFile(path,JSON.stringify({version:1,day:'2026-09-30',attempted:PAYMENT_ZOHO_DAILY_LIMIT-1,limit:PAYMENT_ZOHO_DAILY_LIMIT,updatedAt:''}))
 assert.equal((await reserveZohoBusinessCall(new Date('2026-09-30T00:00:00Z'))).allowed,true)
 const denied=await reserveZohoBusinessCall(new Date('2026-09-30T00:00:01Z'));assert.equal(denied.allowed,false);assert.equal(denied.state.attempted,PAYMENT_ZOHO_DAILY_LIMIT)
 const reset=await reserveZohoBusinessCall(new Date('2026-09-30T18:30:00Z'));assert.equal(reset.allowed,true);assert.equal(reset.state.attempted,1);assert.equal(reset.state.day,'2026-10-01')
 const paymentSearch=await readFile('src/lib/payment-order-search.ts','utf8'),provider=await readFile('src/lib/zoho-payment-orders.ts','utf8'),cron=await readFile('src/app/api/integrations/payment-order-index/route.ts','utf8')
 assert(!paymentSearch.includes("const history=await fetchZohoPaymentOrderPage"),'request-time historical lane must be absent')
 assert(cron.includes('recentOnly:true')&&cron.includes('maxPages:1'),'cron stays explicitly recent-only')
 assert(provider.includes('`/inventory/v1/salesorders?${params}`,1'),'list page is single-attempt')
 console.log('Zoho guardrails passed: IST midnight reset, 1500-call durable cap, over-budget zero-call reservation, historical lane absent, cron/list statically single-page/single-attempt')
}finally{prior===null?await unlink(path).catch(()=>{}):await writeFile(path,prior)}
