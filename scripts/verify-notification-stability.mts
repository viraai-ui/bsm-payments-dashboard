import assert from 'node:assert/strict'
import { emptyNotificationState, optimisticallyRead, reconcileNotifications } from '../src/lib/notification-reconciliation.ts'
import type { PaymentNotification } from '../src/lib/payment-notifications.ts'

const item=(id:string,eventId=id,readAt:string|null=null):PaymentNotification=>({id,eventId,dedupeKey:`${eventId}:u1`,type:'status-received',recipientUserId:'u1',recipientRole:'Salesperson',paymentId:`payment-${id}`,customerName:'Customer',paymentAmount:100,title:'Payment received',body:'Received',message:'Received',url:'/payments',createdAt:`2026-09-24T00:00:0${id==='a'?1:2}.000Z`,readAt})
const snap=(notifications:PaymentNotification[],scope='u1')=>({notifications,unreadCount:notifications.filter(n=>!n.readAt).length,scope})
let state=emptyNotificationState()

// Sequential new -> stale snapshots cannot make a visible event disappear.
state=reconcileNotifications(state,snap([item('a')]),1)
state=reconcileNotifications(state,snap([]),2)
assert.deepEqual(state.items.map(n=>n.id),['a'])
// Repeated delivery of the same stable event ID is deduplicated.
state=reconcileNotifications(state,snap([item('a'),item('a')]),3)
assert.equal(state.items.length,1)
// A new event arriving while an older refresh is in flight survives the delayed response.
state=reconcileNotifications(state,snap([item('b'),item('a')]),5)
state=reconcileNotifications(state,snap([item('a')]),4)
assert.deepEqual(state.items.map(n=>n.id),['b','a'])
// Optimistic read is monotonic against a delayed stale unread poll.
state=optimisticallyRead(state,'a')
state=reconcileNotifications(state,snap([item('a')]),6)
assert.ok(state.items.find(n=>n.id==='a')?.readAt)
// Push-triggered and polling snapshots converge without duplication.
state=reconcileNotifications(state,snap([item('b'),item('a')]),7)
state=reconcileNotifications(state,snap([item('b'),item('a')]),8)
assert.equal(state.items.length,2)
// A component remount consumes the same reconciled state (the client store owns it).
const remounted=state
assert.deepEqual(remounted.items.map(n=>n.id),['b','a'])
// Empty polls are not an implicit deletion policy.
state=reconcileNotifications(state,snap([]),9)
assert.equal(state.items.length,2)
// Session/cross-account scope is an explicit boundary and cannot leak prior items.
state=reconcileNotifications(state,snap([item('a')],'u2'),10)
assert.equal(state.scope,'u2');assert.deepEqual(state.items.map(n=>n.id),['a'])
console.log('notification stability verification passed: stale/new, optimistic read, duplicate event, in-flight refresh, push+poll, remount, explicit scope policy')
