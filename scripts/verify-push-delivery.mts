import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { PushTransport } from '../src/lib/payment-push.ts'
const keys=['NEXT_PUBLIC_VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT'] as const,oldEnv=Object.fromEntries(keys.map(k=>[k,process.env[k]]))
process.env.APP_LOCAL_ONLY='true';process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY='B'.repeat(87);process.env.VAPID_PRIVATE_KEY='C'.repeat(43);process.env.VAPID_SUBJECT='mailto:test@example.test'
const root=process.cwd(),nf=path.join(root,'data/payment-notifications.json'),sf=path.join(root,'data/payment-push-subscriptions.json'),oldN=await readFile(nf,'utf8').catch(()=>'{"notifications":[]}'),oldS=await readFile(sf,'utf8').catch(()=>'{"subscriptions":[]}')
const push=await import('../src/lib/payment-push.ts')
const notification={id:'qa-notification',eventId:'qa-event',dedupeKey:'qa-event:user-a',type:'status-received' as const,recipientUserId:'user-a',recipientRole:'Salesperson' as const,paymentId:'qa-payment',customerName:'QA',paymentAmount:1,title:'QA title',body:'QA body',message:'QA body',url:'/payments',createdAt:new Date().toISOString(),readAt:null}
const raw=(endpoint:string)=>({endpoint,keys:{p256dh:'p'.repeat(65),auth:'a'.repeat(16)}})
try{
 await writeFile(sf,'{"subscriptions":[]}');await push.savePaymentPushSubscription('user-a','Salesperson','device-a',raw('https://push.test/a'));await push.savePaymentPushSubscription('user-a','Salesperson','device-b',raw('https://push.test/b'));await push.savePaymentPushSubscription('user-b','Salesperson','device-wrong',raw('https://push.test/wrong'))
 const subscriptions=(await push.activePaymentPushSubscriptions()).filter(x=>x.userId==='user-a'),jobs=subscriptions.map(s=>push.createPushOutboxItem(notification,s,new Date('2026-01-01T00:00:00Z')))
 assert.equal(new Set(jobs.map(x=>x.id)).size,2,'one stable intent per device');assert.equal(jobs[0].id,push.createPushOutboxItem(notification,subscriptions[0],new Date()).id,'stable delivery id')
 await writeFile(nf,JSON.stringify({notifications:[notification],pushOutbox:jobs}))
 const attempts=new Map<string,number>();const transport:PushTransport=async sub=>{const n=(attempts.get(sub.endpoint)||0)+1;attempts.set(sub.endpoint,n);if(sub.endpoint.endsWith('/a')&&n===1)throw Object.assign(new Error('temporary endpoint https://secret.invalid/token'),{statusCode:503});if(sub.endpoint.endsWith('/b'))throw Object.assign(new Error('gone'),{statusCode:410});return{}}
 let a=await push.deliverPushOutboxItem(jobs.find(x=>x.deviceId==='device-a')!.id,transport,new Date('2026-01-01T00:00:00Z')),b=await push.deliverPushOutboxItem(jobs.find(x=>x.deviceId==='device-b')!.id,transport,new Date('2026-01-01T00:00:00Z'))
 assert.equal(a?.status,'retrying');assert.equal(b?.status,'failed');assert.equal(b?.deliveries[0].status,'expired');assert.equal(attempts.has('https://push.test/wrong'),false);assert.doesNotMatch(a?.lastError||'',/secret\.invalid/)
 a=await push.deliverPushOutboxItem(a!.id,transport,new Date(a!.nextAttemptAt!));assert.equal(a?.status,'delivered');assert.equal(attempts.get('https://push.test/a'),2)
 assert.equal((await push.activePaymentPushSubscriptions()).some(x=>x.deviceId==='device-b'),false,'410 is deactivated')
 const sw=await readFile(path.join(root,'public/payment-push-sw.js'),'utf8');assert.match(sw,/skipWaiting/);assert.match(sw,/clients\.claim/);assert.match(sw,/event\.waitUntil\(Promise\.all/);assert.match(sw,/showNotification/);assert.match(sw,/notificationclick/);assert.match(sw,/clients\.openWindow/)
 console.log('push outbox contract passed: stable per-device intents, wrong-user isolation, awaited retry, terminal 410 cleanup, sanitized errors, worker lifetime/click')
}finally{await writeFile(nf,oldN);await writeFile(sf,oldS);for(const k of keys){const v=oldEnv[k];if(v===undefined)delete process.env[k];else process.env[k]=v}}
