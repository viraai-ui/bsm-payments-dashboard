import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { PushTransport } from '../src/lib/payment-push.ts'
const keys=['NEXT_PUBLIC_VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT','VAPID_KEY_VERSION'] as const,oldEnv=Object.fromEntries(keys.map(k=>[k,process.env[k]]))
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
 // A stored registration is tied to the active VAPID identity. Rotation makes
 // readback fail so the browser re-enrols rather than displaying Enabled.
 await push.savePaymentPushSubscription('user-a','Salesperson','device-key',raw('https://push.test/key'))
 assert.equal(await push.hasPaymentPushSubscription('user-a','https://push.test/key','device-key'),true)
 process.env.VAPID_KEY_VERSION='rotated'
 assert.equal(await push.hasPaymentPushSubscription('user-a','https://push.test/key','device-key'),false,'VAPID version mismatch requires re-enrolment')
 delete process.env.VAPID_KEY_VERSION

 // 400/403 are only cleaned up when provider detail identifies a permanently
 // invalid registration/auth binding; an unrelated forbidden response must not
 // disable that endpoint or any other user's endpoint.
 await push.savePaymentPushSubscription('user-a','Salesperson','device-400',raw('https://push.test/invalid-400'))
 await push.savePaymentPushSubscription('user-a','Salesperson','device-403',raw('https://push.test/invalid-403'))
 await push.savePaymentPushSubscription('user-a','Salesperson','device-forbidden',raw('https://push.test/forbidden'))
 const terminalSubs=(await push.activePaymentPushSubscriptions()).filter(x=>x.deviceId.startsWith('device-')&&['device-400','device-403','device-forbidden'].includes(x.deviceId))
 const terminalJobs=terminalSubs.map((s,i)=>push.createPushOutboxItem({...notification,id:`qa-terminal-${i}`,eventId:`qa-terminal-event-${i}`,dedupeKey:`qa-terminal-${i}:user-a`},s,new Date('2026-01-02T00:00:00Z')))
 await writeFile(nf,JSON.stringify({notifications:[notification],pushOutbox:terminalJobs}))
 const terminalTransport:PushTransport=async sub=>{if(sub.endpoint.endsWith('invalid-400'))throw Object.assign(new Error('invalid subscription'),{statusCode:400,body:'InvalidRegistration'});if(sub.endpoint.endsWith('invalid-403'))throw Object.assign(new Error('authorization failed'),{statusCode:403,body:'VAPID public key mismatch'});throw Object.assign(new Error('forbidden by policy'),{statusCode:403,body:'policy denied'})}
 for(const job of terminalJobs)await push.deliverPushOutboxItem(job.id,terminalTransport,new Date('2026-01-02T00:00:00Z'))
 const activeDevices=new Set((await push.activePaymentPushSubscriptions()).map(x=>x.deviceId))
 assert.equal(activeDevices.has('device-400'),false,'permanent 400 is deactivated')
 assert.equal(activeDevices.has('device-403'),false,'permanent 403 VAPID mismatch is deactivated')
 assert.equal(activeDevices.has('device-forbidden'),true,'generic 403 is not misclassified')
 assert.equal(activeDevices.has('device-wrong'),true,'wrong user endpoint is isolated')
 const sw=await readFile(path.join(root,'public/payment-push-sw.js'),'utf8');assert.match(sw,/skipWaiting/);assert.match(sw,/clients\.claim/);assert.match(sw,/event\.waitUntil\(Promise\.all/);assert.match(sw,/showNotification/);assert.match(sw,/notificationclick/);assert.match(sw,/clients\.openWindow/)
 console.log('push outbox contract passed: stable per-device intents, wrong-user isolation, awaited retry, selective terminal 400/403/410 cleanup, VAPID re-enrolment, sanitized errors, worker lifetime/click')
}finally{await writeFile(nf,oldN);await writeFile(sf,oldS);for(const k of keys){const v=oldEnv[k];if(v===undefined)delete process.env[k];else process.env[k]=v}}
