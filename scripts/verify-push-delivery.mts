import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { PushDelivery, PushTransport } from '../src/lib/payment-push.ts'
process.env.APP_LOCAL_ONLY='true'
process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY='test-public'
process.env.VAPID_PRIVATE_KEY='test-private'
const root=process.cwd(),notificationPath=path.join(root,'data/payment-notifications.json'),subscriptionPath=path.join(root,'data/payment-push-subscriptions.json')
const originalNotifications=await readFile(notificationPath,'utf8').catch(()=>'{"notifications":[]}'),originalSubscriptions=await readFile(subscriptionPath,'utf8').catch(()=>'{"subscriptions":[]}')
const push=await import('../src/lib/payment-push.ts')
const notification={id:'qa-notification',eventId:'qa-event',dedupeKey:'qa-event:user-a',type:'status-received' as const,recipientUserId:'user-a',recipientRole:'Salesperson' as const,paymentId:'qa-payment',customerName:'QA',paymentAmount:1,title:'QA title',body:'QA body',message:'QA body',url:'/payments',createdAt:new Date().toISOString(),readAt:null}
const sub=(endpoint:string,deviceId:string,userId='user-a')=>({endpoint,keys:{p256dh:'p'.repeat(65),auth:'a'.repeat(16)},userId,role:'Salesperson',deviceId,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()})
try{
 const job=push.createPushOutboxItem(notification,new Date('2026-01-01T00:00:00Z'))
 await writeFile(notificationPath,JSON.stringify({notifications:[notification],pushOutbox:[job]}));await writeFile(subscriptionPath,JSON.stringify({subscriptions:[sub('https://push.test/a','device-a'),sub('https://push.test/b','device-b'),sub('https://push.test/wrong','device-wrong','user-b')]}))
 const attempts=new Map<string,number>();const transport:PushTransport=async subscription=>{const n=(attempts.get(subscription.endpoint)||0)+1;attempts.set(subscription.endpoint,n);if(subscription.endpoint.endsWith('/a')&&n===1)throw Object.assign(new Error('temporary'),{statusCode:503});if(subscription.endpoint.endsWith('/b'))throw Object.assign(new Error('gone'),{statusCode:410});return{}}
 let result=await push.deliverPushOutboxItem(job.id,transport,new Date('2026-01-01T00:00:00Z'));assert.equal(result?.status,'retrying');assert.equal(attempts.has('https://push.test/wrong'),false);assert.equal(result?.deliveries.length,2);assert.equal(JSON.parse(await readFile(subscriptionPath,'utf8')).subscriptions.length,2)
 result=await push.deliverPushOutboxItem(job.id,transport,new Date('2026-01-01T00:01:00Z'));assert.equal(result?.status,'delivered');assert.equal(attempts.get('https://push.test/a'),2);assert.equal(attempts.get('https://push.test/b'),1)
 const final=JSON.parse(await readFile(notificationPath,'utf8'));assert.equal(final.pushOutbox.length,1);assert.equal(final.pushOutbox[0].deliveries.filter((d:PushDelivery)=>d.status==='delivered').length,1)
 const sw=await readFile(path.join(root,'public/payment-push-sw.js'),'utf8');assert.match(sw,/event\.waitUntil\(Promise\.all/);assert.match(sw,/showNotification/);assert.match(sw,/notificationclick/);assert.match(sw,/clients\.openWindow/);assert.match(sw,/renotify: true/)
 console.log('push delivery verification passed: multiple devices, wrong-user isolation, transient retry, 410 cleanup, duplicate suppression, audit, service-worker lifetime/click')
}finally{await writeFile(notificationPath,originalNotifications);await writeFile(subscriptionPath,originalSubscriptions)}
