import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
process.env.VERCEL='1';process.env.GITHUB_OWNER='acme';process.env.GITHUB_TOKEN='secret';process.env.GITHUB_REPO='app';process.env.GITHUB_DATA_REPO='data';process.env.APP_LOCAL_ONLY='false';process.env.DATA_CACHE_TTL_SECONDS='1';process.env.DATA_CACHE_STALE_SECONDS='60';process.env.AUTH_SECRET='test-secret-long-enough-for-verification'
const bundled={
 'payments.json':JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../data/payments.json',import.meta.url),'utf8')),
 'payment-notifications.json':JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../data/payment-notifications.json',import.meta.url),'utf8')),
 'auth-users-store.json':JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../data/auth-users-store.json',import.meta.url),'utf8')),
}
const remote=new Map(Object.entries(bundled).map(([name,value],i)=>[`data/${name}`,{value,sha:`sha-${i}`}]))
let calls=0,fail=false
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})
globalThis.fetch=async(url,init={})=>{calls++;if(fail)return json({message:'API rate limit exceeded'},403);const key=decodeURIComponent(String(url).split('/contents/')[1]?.split('?')[0]||'');const method=init.method||'GET',item=remote.get(key);if(method==='PUT'){const body=JSON.parse(init.body);if(!item||item.sha!==body.sha)return json({message:'conflict'},409);const next={value:JSON.parse(Buffer.from(body.content,'base64').toString()),sha:`sha-write-${calls}`};remote.set(key,next);return json({content:{sha:next.sha}},200)}if(!item)return json({},404);return json({type:'file',sha:item.sha,encoding:'base64',content:Buffer.from(JSON.stringify(item.value)).toString('base64')})}
const local=await import('../src/lib/local-store.ts')
const auth=await import('../src/lib/auth.ts')
for(let i=0;i<100;i++)await Promise.all([local.readLocalJson('payments.json',{payments:[]}),local.readLocalJson('payment-notifications.json',{notifications:[]}),local.readLocalJson('auth-users-store.json',null)])
assert.equal(calls,3,'100 read rounds should make one GitHub call per raw store')
local.clearLocalStoreCache();calls=0
await Promise.all(Array.from({length:100},()=>local.readLocalJson('payments.json',{payments:[]})))
assert.equal(calls,1,'concurrent cache misses must deduplicate')
await new Promise(resolve=>setTimeout(resolve,1050));fail=true
const stale=await local.readLocalJson('payments.json',{payments:[]});assert.equal(stale.payments.filter(p=>p.salesOrderNumber==='SO-07976').length,2);assert.equal(calls,2,'expired read attempts GitHub once then serves stale')
local.clearLocalStoreCache();const before=calls
const user=await auth.authenticate('admin','1231');assert.equal(user?.id,'u-admin','login must use bundled password hash during GitHub 403');assert.equal(calls,before+1)
const unchanged=JSON.stringify(remote.get('data/payments.json').value);await assert.rejects(()=>local.updateLocalJson('payments.json',{payments:[]},s=>({...s,shouldNotPersist:true})),/temporarily unavailable/);assert.equal(JSON.stringify(remote.get('data/payments.json').value),unchanged,'rate-limited write must not mutate durable data')
fail=false;local.clearLocalStoreCache();calls=0
await local.updateLocalJson('payments.json',{payments:[]},s=>({...s,cacheVerification:true}));assert.equal(calls,2,'write performs one authoritative read and one write')
await local.readLocalJson('payments.json',{payments:[]});assert.equal(calls,2,'successful write updates read cache')
assert.equal(remote.get('data/payments.json').value.cacheVerification,true)
const notifications=await readFile(new URL('../src/components/NotificationCenter.tsx',import.meta.url),'utf8'),paymentsClient=await readFile(new URL('../src/components/PaymentsClient.tsx',import.meta.url),'utf8'),publicForm=await readFile(new URL('../src/app/submit-payment/PublicPaymentForm.tsx',import.meta.url),'utf8')
assert.match(notifications,/notificationRequest/)
const notificationFetchCount = notifications.split('/api/payments/notifications').length - 1
assert.equal(notificationFetchCount,2,'one GET plus one PATCH endpoint use expected')
assert(notifications.includes('setInterval(visible,4000)'),'notification feed must synchronize within five seconds')
assert(paymentsClient.includes('}, 4000);'),'payments must synchronize within five seconds')
assert(publicForm.includes('}, 60000)'))
console.log('PASS cache: 100x3 reads=3 calls; 100 concurrent=1; stale 403 preserves two SO-07976 records; bundled login succeeds; write updates cache')
