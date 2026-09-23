import webpush, { type PushSubscription as WebPushSubscription } from 'web-push'
import { readLocalJson, updateLocalJson } from './local-store'
import type { AppRole } from './auth'
import type { PaymentNotification } from './payment-notifications'

export type StoredPushSubscription = WebPushSubscription & {
  userId: string
  role: AppRole
  deviceId: string
  createdAt: string
  updatedAt: string
}
type PushStore = { subscriptions: StoredPushSubscription[] }
const FILE = 'payment-push-subscriptions.json'
const EMPTY: PushStore = { subscriptions: [] }

export function paymentPushConfiguration() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''
  const privateKey = process.env.VAPID_PRIVATE_KEY || ''
  return { configured: Boolean(publicKey && privateKey), publicKey }
}
export async function savePaymentPushSubscription(userId: string, role: AppRole, deviceId: string, subscription: WebPushSubscription) {
  const now = new Date().toISOString()
  await updateLocalJson(FILE, EMPTY, store => {
    const old = store.subscriptions.find(item => item.endpoint === subscription.endpoint)
    return { subscriptions: [{ ...subscription, userId, role, deviceId, createdAt: old?.createdAt || now, updatedAt: now }, ...store.subscriptions.filter(item => item.endpoint !== subscription.endpoint && !(item.userId === userId && item.deviceId === deviceId))] }
  })
}
export async function removePaymentPushSubscription(userId: string, endpoint: string) {
  await updateLocalJson(FILE, EMPTY, store => ({ subscriptions: store.subscriptions.filter(item => !(item.userId === userId && item.endpoint === endpoint)) }))
}

/** Sends only to subscriptions owned by the exact server-selected recipients. */
export function isPaymentPushEligible(notification: Pick<PaymentNotification, 'recipientUserId' | 'recipientRole'>, subscription: Pick<StoredPushSubscription, 'userId' | 'role'>) {
  return subscription.userId === notification.recipientUserId && subscription.role === notification.recipientRole
}
export async function sendPaymentPushNotifications(notifications: PaymentNotification[]) {
  const config = paymentPushConfiguration()
  if (!config.configured) return { sent: 0, configured: false }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:accounts@bsmindia.com', config.publicKey, process.env.VAPID_PRIVATE_KEY!)
  const store = await readLocalJson(FILE, EMPTY)
  const dead = new Set<string>()
  let sent = 0
  await Promise.allSettled(notifications.flatMap(notification => store.subscriptions
    .filter(subscription => isPaymentPushEligible(notification, subscription))
    .map(async subscription => {
      try {
        await webpush.sendNotification(subscription, JSON.stringify({
          title: notification.title,
          body: notification.body,
          url: notification.url,
          tag: notification.eventId,
          paymentId: notification.paymentId,
        }), { TTL: 60 * 60, urgency: 'high' })
        sent += 1
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) dead.add(subscription.endpoint)
        console.error('Payment push delivery failed', { status })
      }
    })))
  if (dead.size) await updateLocalJson(FILE, EMPTY, current => ({ subscriptions: current.subscriptions.filter(item => !dead.has(item.endpoint)) })).catch(error => console.error('Could not clean dead push subscriptions', error))
  return { sent, configured: true }
}
