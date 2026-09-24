import { getUserStore, type AppRole } from './auth'
import { readLocalJsonFresh, updateLocalJson } from './local-store'
import type { Payment, PaymentStatus } from './payments'
import { sendPaymentPushNotifications } from './payment-push'

export type NotificationType = 'boss-payment-created' | 'unauthorised-created' | 'status-received' | 'status-pending' | 'status-void'
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
type Store = { notifications: PaymentNotification[] }
const FILE = 'payment-notifications.json'
const EMPTY: Store = { notifications: [] }

export function formatPaymentAmount(amount: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount).replace(/^₹\s*/, '₹')
}
function paymentSummary(payment: Payment) {
  const base = `${formatPaymentAmount(payment.paymentAmount)} from ${payment.customerName}`
  return payment.salesOrderNumber ? `${base} • ${payment.salesOrderNumber}` : base
}

async function notify(payment: Payment, type: NotificationType, recipients: Array<{ id: string; role: AppRole }>, title: string, body: string, eventId: string, url = `/payments?payment=${encodeURIComponent(payment.id)}`) {
  const now = new Date().toISOString()
  let made: PaymentNotification[] = []
  await updateLocalJson(FILE, EMPTY, store => {
    const existing = new Set(store.notifications.map(item => item.dedupeKey))
    made = recipients.map(recipient => {
      const dedupeKey = `${eventId}:${recipient.id}`
      return {
        id: `notification-${crypto.randomUUID()}`, eventId, dedupeKey, type,
        recipientUserId: recipient.id, recipientRole: recipient.role, paymentId: payment.id,
        salesOrderNumber: payment.salesOrderNumber, utrReference: payment.utrReference, customerName: payment.customerName,
        paymentAmount: payment.paymentAmount, title, body, message: body,
        url, createdAt: now, readAt: null,
      }
    }).filter(item => !existing.has(item.dedupeKey))
    return { notifications: [...made, ...store.notifications].slice(0, 2000) }
  })
  if (made.length) await sendPaymentPushNotifications(made).catch(error => console.error('Payment push dispatch failed', error))
  return made
}

/** Creation events have deliberately disjoint audiences: the shared claim queue
 * goes to Salespeople, while linked payments go only to Viewer/Boss accounts. */
export async function createPaymentNotifications(payment: Payment, creator: string) {
  const users = (await getUserStore()).users
  if (payment.status === 'Unauthorised') {
    const recipients = users.filter(user => user.active && user.role === 'Salesperson' && user.id !== creator)
    const reference = payment.utrReference ? ` • UTR / Reference: ${payment.utrReference}` : ''
    return notify(payment, 'unauthorised-created', recipients, 'Unauthorised payment available to claim', `${paymentSummary(payment)}${reference}`, `unauthorised-created:${payment.id}`, '/payments?view=unauthorised')
  }
  if (!payment.salesOrderNumber || (payment.status !== 'Pending' && payment.status !== 'Payment Received')) return []
  const recipients = users.filter(user => user.active && user.role === 'Viewer')
  const title = payment.status === 'Payment Received' ? 'New payment received' : 'New payment added'
  const body = `${formatPaymentAmount(payment.paymentAmount)} • Sales Order ${payment.salesOrderNumber}`
  return notify(payment, 'boss-payment-created', recipients, title, body, `boss-payment-created:${payment.id}`)
}

/** Status events are private to the stable salesperson owner/claimant. */
export async function createStatusNotification(payment: Payment, status: 'Pending' | 'Payment Received' | 'Void', previousStatus?: PaymentStatus) {
  if (status === 'Pending' && previousStatus !== 'Payment Received') return []
  const ownerId = payment.ownerUserId || payment.claimedBy || payment.createdBy
  const owner = (await getUserStore()).users.find(user => user.id === ownerId && user.active && user.role === 'Salesperson')
  if (!owner) return []
  const amountCompany = `${formatPaymentAmount(payment.paymentAmount)} from ${payment.customerName}${payment.salesOrderNumber ? ` • ${payment.salesOrderNumber}` : ''}`
  const copy = status === 'Payment Received'
    ? { type: 'status-received' as const, title: 'Payment received', body: `Your payment of ${amountCompany} has been received.` }
    : status === 'Void'
      ? { type: 'status-void' as const, title: 'Payment voided', body: `Your payment of ${amountCompany} was marked void.` }
      : { type: 'status-pending' as const, title: 'Payment moved to pending', body: `Your payment of ${amountCompany} was moved to pending.` }
  return notify(payment, copy.type, [owner], copy.title, copy.body, `status:${payment.id}:${previousStatus || 'unknown'}:${status}:${payment.updatedAt}`)
}

/** Claiming establishes ownership but intentionally emits no notification. */
export async function createClaimNotification(_payment: Payment) { return [] as PaymentNotification[] }

export async function listPaymentNotifications(userId: string, allowedPaymentIds?: Set<string>) {
  // Notifications are live synchronization state. A process-local cached copy is
  // unsafe on serverless: alternating instances otherwise return different
  // generations for up to DATA_CACHE_TTL_SECONDS (the visible flicker).
  const items = (await readLocalJsonFresh(FILE, EMPTY)).notifications
    .filter(item => Boolean(item.eventId && item.title && item.body) && item.recipientUserId === userId && (!allowedPaymentIds || allowedPaymentIds.has(item.paymentId)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50)
  return { notifications: items, unreadCount: items.filter(item => !item.readAt).length }
}
export async function markPaymentNotificationsRead(userId: string, id?: string) {
  const now = new Date().toISOString()
  await updateLocalJson(FILE, EMPTY, store => ({ notifications: store.notifications.map(item => item.recipientUserId === userId && !item.readAt && (!id || id === item.id) ? { ...item, readAt: now } : item) }))
  return listPaymentNotifications(userId)
}
export async function removePaymentNotifications(paymentId: string) {
  return updateLocalJson(FILE, EMPTY, store => ({ notifications: store.notifications.filter(item => item.paymentId !== paymentId) }))
}
