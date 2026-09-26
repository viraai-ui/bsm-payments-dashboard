import assert from 'node:assert/strict'
import { readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'

process.env.APP_LOCAL_ONLY='true'
for(const key of ['NEXT_PUBLIC_VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT']) delete process.env[key]
const root=process.cwd(),data=path.join(root,'data')
const authPath=path.join(data,'auth-users-store.json'),notificationPath=path.join(data,'payment-notifications.json'),subscriptionPath=path.join(data,'payment-push-subscriptions.json')
const backup=async file=>{try{return await readFile(file,'utf8')}catch{return null}}
const originals=await Promise.all([backup(authPath),backup(notificationPath),backup(subscriptionPath)])
const n=await import(path.join(root,'src/lib/payment-notifications.ts')),{getUserStore,saveUserStore}=await import(path.join(root,'src/lib/auth.ts'))
const original=await getUserStore(),seed=original.users[0],now='2026-09-26T00:00:00.000Z'
const user=(id,role,active=true)=>({...seed,id,name:id,email:`${id}@test.invalid`,username:id,role,active,createdAt:now,updatedAt:now})
const users=[user('sales-owner','Salesperson'),user('sales-two','Salesperson'),user('sales-inactive','Salesperson',false),user('admin-one','Admin'),user('admin-two','Admin'),user('accounts-one','Accounts'),user('viewer-one','Viewer'),user('viewer-two','Viewer'),user('viewer-inactive','Viewer',false)]
const subscriptions=users.filter(u=>u.active).flatMap((u,index)=>[0,1].map(device=>({id:`sub-${index}-${device}`,userId:u.id,role:u.role,deviceId:`device-${device}`,endpoint:`https://push.test/${u.id}/${device}`,keys:{p256dh:'test',auth:'test'},createdAt:now,updatedAt:now})))
await saveUserStore({...original,users});await writeFile(notificationPath,JSON.stringify({notifications:[],pushOutbox:[]}));await writeFile(subscriptionPath,JSON.stringify({subscriptions}))
let assertions=0;const eq=(a,b)=>{assert.deepEqual(a,b);assertions++},ok=v=>{assert.ok(v);assertions++}
const recipientIds=made=>new Set(made.map(x=>x.recipientUserId)),expectedManagement=new Set(['admin-one','admin-two','accounts-one','viewer-one','viewer-two'])
const base={id:'linked-pending',customerName:'V.S. Enterprises',salesOrderNumber:'SO-07976',paymentAmount:52545,status:'Pending',createdBy:'sales-owner',ownerUserId:'sales-owner',paymentDate:'2026-01-01',createdAt:now,updatedAt:now}
try{
 let made=await n.createPaymentNotifications(base,'sales-owner')
 eq(recipientIds(made),expectedManagement);ok(made.every(x=>x.type==='linked-payment-created'));eq(made[0].title,'New payment added');eq(made[0].body,'₹52,545 from V.S. Enterprises • Sales Order SO-07976');ok(!recipientIds(made).has('sales-owner'));ok(!recipientIds(made).has('sales-two'));ok(!recipientIds(made).has('viewer-inactive'));eq((await n.createPaymentNotifications(base,'sales-owner')).length,0)
 made=await n.createPaymentNotifications({...base,id:'linked-received',status:'Payment Received'},'sales-owner');eq(recipientIds(made),expectedManagement);eq(made[0].title,'New payment received')
 eq((await n.createPaymentNotifications({...base,id:'linked-admin'},'admin-one')).length,0);eq((await n.createPaymentNotifications({...base,id:'linked-public'},'public-salesman')).length,0)
 const unauthorised={...base,id:'unauthorised',status:'Unauthorised',salesOrderNumber:undefined,utrReference:'UTR-4499',createdBy:'accounts-one'}
 made=await n.createPaymentNotifications(unauthorised,'accounts-one');eq(recipientIds(made),new Set(['sales-owner','sales-two']));ok(made.every(x=>x.type==='unauthorised-created'&&x.recipientRole==='Salesperson'));eq(made[0].title,'Unauthorised payment added');eq(made[0].body,'₹52,545 from V.S. Enterprises • UTR / Reference: UTR-4499 • Available to claim');eq(made[0].url,'/payments?view=unauthorised')
 made=await n.createPaymentNotifications({...unauthorised,id:'unauthorised-admin',createdBy:'admin-one'},'admin-one');eq(recipientIds(made),new Set(['sales-owner','sales-two']))
 eq((await n.createPaymentNotifications({...unauthorised,id:'unauthorised-sales'},'sales-owner')).length,0);eq((await n.createPaymentNotifications({...unauthorised,id:'unauthorised-viewer'},'viewer-one')).length,0);eq((await n.createPaymentNotifications({...unauthorised,id:'unauthorised-unknown'},'missing')).length,0)
 const received={...base,id:'status-payment',status:'Payment Received',updatedAt:'2026-01-02T00:00:00.000Z'};made=await n.createStatusNotification(received,'Payment Received','Pending');eq(recipientIds(made),new Set(['sales-owner']));eq(made[0].title,'Payment received');eq((await n.createStatusNotification({...received,updatedAt:'2026-01-03T00:00:00.000Z'},'Payment Received','Pending')).length,0);eq((await n.createStatusNotification(received,'Payment Received','Payment Received')).length,0)
 eq((await n.createStatusNotification({...base,id:'status-pending'},'Pending','Payment Received')).length,0)
 made=await n.createStatusNotification({...base,id:'status-void',status:'Void'},'Void','Pending');eq(recipientIds(made),new Set(['sales-owner']));eq(made[0].title,'Payment voided');ok(!made.some(x=>['Admin','Accounts','Viewer'].includes(x.recipientRole)))
 eq((await n.createStatusNotification({...base,id:'wrong-owner',ownerUserId:'admin-one',status:'Void'},'Void','Pending')).length,0);eq((await n.createStatusNotification({...base,id:'inactive-owner',ownerUserId:'sales-inactive',status:'Void'},'Void','Pending')).length,0)
 const claim={...base,id:'claim-child',parentPaymentId:'unauthorised-parent',claimedBy:'sales-owner',claimedAt:now,status:'Payment Received',salesOrderId:'zoho-order-7976'}
 made=await n.createClaimNotification(claim,'sales-owner');eq(recipientIds(made),new Set(['admin-one','admin-two','accounts-one']));ok(made.every(x=>x.type==='payment-claimed'&&(x.recipientRole==='Admin'||x.recipientRole==='Accounts')));eq(made[0].title,'Payment claimed');eq(made[0].body,'sales-owner claimed ₹52,545 from V.S. Enterprises • Linked to SO-07976');ok(!recipientIds(made).has('viewer-one'));ok(!recipientIds(made).has('sales-owner'));ok(!recipientIds(made).has('sales-two'));eq(made.length,3)
 eq((await n.createClaimNotification(claim,'sales-owner')).length,0);eq((await n.createClaimNotification(claim,'admin-one')).length,0);eq((await n.createClaimNotification({...claim,id:'claim-inactive',claimedBy:'sales-inactive'},'sales-inactive')).length,0);eq((await n.createClaimNotification({...claim,id:'claim-no-so',salesOrderId:undefined,salesOrderNumber:undefined},'sales-owner')).length,0);eq((await n.createClaimNotification({...claim,id:'claim-no-parent',parentPaymentId:undefined},'sales-owner')).length,0)
 const store=JSON.parse(await readFile(notificationPath,'utf8'));const expectedJobs=store.notifications.length*2;eq(store.pushOutbox.length,expectedJobs);eq(new Set(store.pushOutbox.map(x=>x.notificationId)).size,store.notifications.length);ok(store.notifications.every(x=>store.pushOutbox.filter(j=>j.notificationId===x.id).length===2));ok(store.pushOutbox.every(j=>j.recipientUserId===store.notifications.find(x=>x.id===j.notificationId)?.recipientUserId));ok(store.pushOutbox.every(j=>j.status==='pending'))
 const beforeJobs=store.pushOutbox.length;await n.markPaymentNotificationsRead('viewer-one');eq(JSON.parse(await readFile(notificationPath,'utf8')).pushOutbox.length,beforeJobs)
 console.log(`notification matrix: ${assertions} assertions passed; ${store.notifications.length} in-app rows and ${store.pushOutbox.length} per-device outbox jobs verified`)
}finally{
 for(const [file,content] of [[authPath,originals[0]],[notificationPath,originals[1]],[subscriptionPath,originals[2]]])content===null?await rm(file,{force:true}):await writeFile(file,content)
}
