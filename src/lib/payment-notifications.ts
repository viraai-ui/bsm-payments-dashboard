import { githubReadJson, githubRequest } from './workflow-store'
import { getUserStore } from './auth'
import type { Payment } from './payments'

export type PaymentNotification = {
  id: string
  type: 'payment-created'
  recipientUserId: string
  paymentId: string
  salesOrderNumber: string
  customerName: string
  paymentAmount?: number
  createdAt: string
  readAt: string | null
}

type NotificationStore = { notifications: PaymentNotification[] }
const STORE_PATH = 'data/payment-notifications.json'
const EMPTY: NotificationStore = { notifications: [] }

async function updateStore(updater: (items: PaymentNotification[]) => PaymentNotification[]) {
  let lastError: unknown
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await githubReadJson<NotificationStore>(STORE_PATH, EMPTY)
    const next = { notifications: updater(current.data.notifications || []).slice(0, 1000) }
    const body: Record<string, string> = {
      message: 'Update payment notifications',
      content: Buffer.from(JSON.stringify(next, null, 2)).toString('base64'),
    }
    if (current.sha) body.sha = current.sha
    try {
      await githubRequest(`/contents/${STORE_PATH}`, { method: 'PUT', body: JSON.stringify(body) })
      return next.notifications
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : ''
      if (!/sha|409|does not match/i.test(message)) break
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Notification update conflict')
}

export async function createPaymentNotifications(payment: Payment, creatorUserId: string) {
  const { users } = await getUserStore()
  const recipients = users.filter((user) => user.active && (user.role === 'Admin' || user.role === 'Accounts') && user.id !== creatorUserId)
  if (!recipients.length) return []
  const createdAt = new Date().toISOString()
  const created = recipients.map((user) => ({
    id: `payment-notification-${crypto.randomUUID()}`,
    type: 'payment-created' as const,
    recipientUserId: user.id,
    paymentId: payment.id,
    salesOrderNumber: payment.salesOrderNumber || 'No Sales Order',
    customerName: payment.customerName,
    paymentAmount: payment.paymentAmount,
    createdAt,
    readAt: null,
  }))
  await updateStore((items) => [...created, ...items])
  return created
}

export async function listPaymentNotifications(userId: string) {
  const { data } = await githubReadJson<NotificationStore>(STORE_PATH, EMPTY)
  const notifications = (data.notifications || []).filter((item) => item.recipientUserId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50)
  return { notifications, unreadCount: notifications.filter((item) => !item.readAt).length }
}

export async function markPaymentNotificationsRead(userId: string, id?: string) {
  const now = new Date().toISOString()
  await updateStore((items) => items.map((item) => item.recipientUserId === userId && !item.readAt && (!id || item.id === id) ? { ...item, readAt: now } : item))
  return listPaymentNotifications(userId)
}

export async function removePaymentNotifications(paymentId: string) {
  return updateStore((items) => items.filter((item) => item.paymentId !== paymentId))
}
