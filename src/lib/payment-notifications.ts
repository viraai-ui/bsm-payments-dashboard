import { getUserStore, type AppRole } from './auth'
import { createHash } from 'node:crypto'
import { readLocalJsonFresh, updateLocalJson } from './local-store'
import type { Payment, PaymentStatus } from './payments'
import { activePaymentPushSubscriptions, createPushOutboxItem, sendPaymentPushNotifications, type PushOutboxItem } from './payment-push'
import { paymentCustomerLabel } from './payment-domain'

export type NotificationType = 'linked-payment-created' | 'boss-payment-created' | 'unauthorised-created' | 'payment-claimed' | 'status-received' | 'status-pending' | 'status-void' | 'system-test'
export type PaymentNotification = {
  id: string
  eventId: string
  dedupeKey: string
  type: NotificationType
  recipientUserId: string
  recipientRole: AppRole
  paymentId: string
  salesOrderNumber?: string
  utrReference?: string
  customerName: string
  paymentAmount: number
  title: string
  body: string
  message: string
  url: string
  createdAt: string
  readAt: string | null
}
type Store = { notifications: PaymentNotification[]; pushOutbox?: PushOutboxItem[] }
const FILE = 'payment-notifications.json'
const EMPTY: Store = { notifications: [] }

export function formatPaymentAmount(amount: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount).replace(/^₹\s*/, '₹')
}
function paymentSummary(payment: Payment) {
  const base = `${formatPaymentAmount(payment.paymentAmount)} from ${paymentCustomerLabel(payment.customerName)}`
  return payment.salesOrderNumber ? `${base} • ${payment.salesOrderNumber}` : base
}

async function notify(payment: Payment, type: NotificationType, recipients: Array<{ id: string; role: AppRole }>, title: string, body: string, eventId: string, url = `/payments?payment=${encodeURIComponent(payment.id)}`) {
  const now = new Date().toISOString()
  const subscriptions = await activePaymentPushSubscriptions()
  let made: PaymentNotification[] = []
  await updateLocalJson(FILE, EMPTY, store => {
    const existing = new Set(store.notifications.map(item => item.dedupeKey))
    made = recipients.map(recipient => {
      const dedupeKey = `${eventId}:${recipient.id}`
      return {
        id: `notification-${createHash('sha256').update(dedupeKey).digest('hex').slice(0,32)}`, eventId, dedupeKey, type,
        recipientUserId: recipient.id, recipientRole: recipient.role, paymentId: payment.id,
        salesOrderNumber: payment.salesOrderNumber, utrReference: payment.utrReference, customerName: payment.customerName,
        paymentAmount: payment.paymentAmount, title, body, message: body,
        url, createdAt: now, readAt: null,
      }
    }).filter(item => !existing.has(item.dedupeKey))
    const jobs = made.flatMap(item => subscriptions.filter(subscription => subscription.userId === item.recipientUserId && subscription.role === item.recipientRole).map(subscription => createPushOutboxItem(item, subscription)))
    const jobIds = new Set((store.pushOutbox || []).map(item => item.id))
    return { notifications: [...made, ...store.notifications].slice(0, 2000), pushOutbox: [...jobs.filter(item => !jobIds.has(item.id)), ...(store.pushOutbox || [])].slice(0, 8000) }
  })
  if (made.length) await sendPaymentPushNotifications(made).catch(error => console.error('Payment push dispatch failed', error))
  return made
}

/** The authoritative creation matrix. The actor is resolved again here so a
 * future non-route caller cannot broaden an audience by supplying an arbitrary
 * creator id. Public/anonymous submissions intentionally emit no notification. */
export async function createPaymentNotifications(payment: Payment, creator: string) {
  const users = (await getUserStore()).users
  const actor = users.find(user => user.id === creator && user.active)
  if (payment.status === 'Unauthorised') {
    if (!actor || (actor.role !== 'Admin' && actor.role !== 'Accounts')) return []
    const recipients = users.filter(user => user.active && user.role === 'Salesperson')
    const reference = payment.utrReference ? ` • UTR / Reference: ${payment.utrReference}` : ''
    return notify(payment, 'unauthorised-created', recipients, 'Unauthorised payment added', `${paymentSummary(payment)}${reference} • Available to claim`, `unauthorised-created:${payment.id}`, '/payments?view=unauthorised')
  }
  if (!actor || actor.role !== 'Salesperson' || !payment.salesOrderNumber || (payment.status !== 'Pending' && payment.status !== 'Payment Received')) return []
  const recipients = users.filter(user => user.active && user.id !== creator && (user.role === 'Admin' || user.role === 'Accounts' || user.role === 'Viewer'))
  const title = payment.status === 'Payment Received' ? 'New payment received' : 'New payment added'
  const body = `${formatPaymentAmount(payment.paymentAmount)} from ${paymentCustomerLabel(payment.customerName)} • Sales Order ${payment.salesOrderNumber}`
  return notify(payment, 'linked-payment-created', recipients, title, body, `linked-payment-created:${payment.id}`)
}

/** Status events are private to the stable salesperson owner/claimant. */
export async function createStatusNotification(payment: Payment, status: 'Pending' | 'Payment Received' | 'Void', previousStatus?: PaymentStatus) {
  if (status === 'Pending' || status === previousStatus) return []
  const ownerId = payment.ownerUserId || payment.claimedBy || payment.createdBy
  const owner = (await getUserStore()).users.find(user => user.id === ownerId && user.active && user.role === 'Salesperson')
  if (!owner) return []
  const amountCompany = `${formatPaymentAmount(payment.paymentAmount)} from ${paymentCustomerLabel(payment.customerName)}${payment.salesOrderNumber ? ` • ${payment.salesOrderNumber}` : ''}`
  const copy = status === 'Payment Received'
    ? { type: 'status-received' as const, title: 'Payment received', body: `Your payment of ${amountCompany} has been received.` }
    : status === 'Void'
      ? { type: 'status-void' as const, title: 'Payment voided', body: `Your payment of ${amountCompany} was marked void.` }
      : { type: 'status-void' as const, title: 'Payment voided', body: `Your payment of ${amountCompany} was marked void.` }
  return notify(payment, copy.type, [owner], copy.title, copy.body, `status:${payment.id}:${status}`)
}

/** Notify management only for a committed allocation claimed by the authenticated
 * active salesperson. Identity and copy are rebuilt from stable server-side data;
 * the child payment id is the durable, globally stable claim event key. */
export async function createClaimNotification(payment: Payment, authenticatedActorId?: string) {
  if (!authenticatedActorId || !payment.parentPaymentId || !payment.claimedBy || payment.claimedBy !== authenticatedActorId || payment.status !== 'Payment Received' || !payment.salesOrderId || !payment.salesOrderNumber) return []
  const users = (await getUserStore()).users
  const claimant = users.find(user => user.id === authenticatedActorId && user.active && user.role === 'Salesperson')
  if (!claimant) return []
  const recipients = users.filter(user => user.active && (user.role === 'Admin' || user.role === 'Accounts'))
  const claimantName = claimant.name || claimant.username
  const body = `${claimantName} claimed ${formatPaymentAmount(payment.paymentAmount)} from ${paymentCustomerLabel(payment.customerName)} • Linked to ${payment.salesOrderNumber}`
  return notify(payment, 'payment-claimed', recipients, 'Payment claimed', body, `payment-claimed:${payment.id}`)
}

/** Admin-only callers use this idempotent test run through the real outbox. */
export async function createAllUsersTestNotifications(runId:string) {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(runId)) throw new Error('Invalid test run id')
  const recipients=(await getUserStore()).users.filter(user=>user.active).map(user=>({id:user.id,role:user.role}))
  const now=new Date().toISOString()
  const synthetic={id:`system-test-${runId}`,customerName:'Notification test',paymentAmount:0,status:'Pending',createdBy:'system',createdAt:now,updatedAt:now} as Payment
  return notify(synthetic,'system-test',recipients,'TEST — BSM payment notifications','This is a clearly labeled delivery test. No action is required.',`system-test:${runId}`,'/payments')
}

export async function listPaymentNotifications(userId: string, allowedPaymentIds?: Set<string>) {
  // Notifications are live synchronization state. A process-local cached copy is
  // unsafe on serverless: alternating instances otherwise return different
  // generations for up to DATA_CACHE_TTL_SECONDS (the visible flicker).
  const items = (await readLocalJsonFresh(FILE, EMPTY)).notifications
    .filter(item => Boolean(item.eventId && item.title && item.body) && item.recipientUserId === userId && (item.type === 'system-test' || !allowedPaymentIds || allowedPaymentIds.has(item.paymentId)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50)
  return { notifications: items, unreadCount: items.filter(item => !item.readAt).length }
}
export async function markPaymentNotificationsRead(userId: string, id?: string) {
  const now = new Date().toISOString()
  await updateLocalJson(FILE, EMPTY, store => ({ ...store, notifications: store.notifications.map(item => item.recipientUserId === userId && !item.readAt && (!id || id === item.id) ? { ...item, readAt: now } : item) }))
  return listPaymentNotifications(userId)
}
export async function removePaymentNotifications(paymentId: string) {
  return updateLocalJson(FILE, EMPTY, store => ({ ...store, notifications: store.notifications.filter(item => item.paymentId !== paymentId) }))
}
