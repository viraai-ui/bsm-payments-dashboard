import webpush, { type PushSubscription as WebPushSubscription } from 'web-push'
import { githubReadJson, githubRequest } from './workflow-store'

export type StoredPushSubscription = WebPushSubscription & { userId: string; role: 'Admin' | 'Accounts'; createdAt: string; updatedAt: string }
type PushStore = { subscriptions: StoredPushSubscription[] }
const STORE_PATH = 'data/payment-push-subscriptions.json'

async function updateStore(updater: (items: StoredPushSubscription[]) => StoredPushSubscription[]) {
  let lastError: unknown
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await githubReadJson<PushStore>(STORE_PATH, { subscriptions: [] })
    const next = { subscriptions: updater(current.data.subscriptions || []) }
    const body: Record<string, string> = { message: 'Update payment push subscriptions', content: Buffer.from(JSON.stringify(next, null, 2)).toString('base64') }
    if (current.sha) body.sha = current.sha
    try {
      await githubRequest(`/contents/${STORE_PATH}`, { method: 'PUT', body: JSON.stringify(body) })
      return next.subscriptions
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : ''
      if (!message.includes('sha') && !message.includes('409') && !message.includes('does not match')) break
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Push subscription update conflict')
}

export async function savePaymentPushSubscription(userId: string, role: 'Admin' | 'Accounts', subscription: WebPushSubscription) {
  const now = new Date().toISOString()
  await updateStore((items) => [{ ...subscription, userId, role, createdAt: items.find((item) => item.endpoint === subscription.endpoint)?.createdAt || now, updatedAt: now }, ...items.filter((item) => item.endpoint !== subscription.endpoint)])
}

export async function removePaymentPushSubscription(userId: string, endpoint: string) {
  await updateStore((items) => items.filter((item) => !(item.userId === userId && item.endpoint === endpoint)))
}

export async function notifyAccountsOfNewPayment(payment: { id: string; customerName: string; salesOrderNumber?: string; paymentAmount?: number }) {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:accounts@bsmindia.com'
  if (!publicKey || !privateKey) return { sent: 0, configured: false }
  webpush.setVapidDetails(subject, publicKey, privateKey)
  const { data } = await githubReadJson<PushStore>(STORE_PATH, { subscriptions: [] })
  const recipients = (data.subscriptions || []).filter((item) => item.role === 'Accounts' || item.role === 'Admin')
  const dead = new Set<string>()
  let sent = 0
  const amount = payment.paymentAmount == null ? '' : ` • ₹${payment.paymentAmount.toLocaleString('en-IN')}`
  await Promise.allSettled(recipients.map(async (subscription) => {
    try {
      await webpush.sendNotification(subscription, JSON.stringify({ title: 'New payment awaiting approval', body: `${payment.customerName} • ${payment.salesOrderNumber || 'No Sales Order'}${amount}`, url: '/payments', tag: payment.id }), { TTL: 60 * 60, urgency: 'high' })
      sent += 1
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) dead.add(subscription.endpoint)
      console.error('Payment push delivery failed', { status })
    }
  }))
  if (dead.size) await updateStore((items) => items.filter((item) => !dead.has(item.endpoint))).catch((error) => console.error('Could not clean dead push subscriptions', error))
  return { sent, configured: true }
}
