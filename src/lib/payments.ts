import { githubReadJson, githubRequest } from './workflow-store'

export type PaymentStatus = 'Pending' | 'Payment Received'
export type PaymentMode = 'Bank Transfer' | 'UPI' | 'Cash' | 'Credit Card' | 'Debit Card' | 'Other'
export const PAYMENT_ADDED_BY_USERS = ['Anuj', 'Deepak', 'Ram', 'Karan', 'Shivani', 'Manisha', 'Sonia'] as const
export type PaymentAddedBy = typeof PAYMENT_ADDED_BY_USERS[number]
export function isPaymentAddedBy(value: unknown): value is PaymentAddedBy {
  return typeof value === 'string' && PAYMENT_ADDED_BY_USERS.includes(value as PaymentAddedBy)
}
export type PaymentAttachment = { key: string; url: string; name: string; contentType: string; size: number }
export type Payment = {
  id: string
  customerName: string
  /** Absent for a manually entered customer payment. */
  salesOrderNumber?: string
  /** Optional only for records created before payment details were introduced. */
  paymentAmount?: number
  /** Optional only for records created before payment details were introduced. */
  paymentMode?: PaymentMode
  screenshotUrl?: string
  screenshotKey?: string
  screenshotName?: string
  /** Canonical proof collection. Legacy screenshot fields remain readable. */
  attachments?: PaymentAttachment[]
  remarks?: string
  /** Explicitly selected submitter. Optional only for legacy records. */
  addedBy?: PaymentAddedBy
  status: PaymentStatus
  createdBy: string
  /** Server-generated deduplication key for public submissions; never returned by public APIs. */
  idempotencyKey?: string
  /** SHA-256 verifier for a public device deletion capability. Never expose publicly. */
  publicDeleteTokenHash?: string
  createdAt: string
  updatedAt: string
}

type PaymentStore = { payments: Payment[] }
const STORE_PATH = 'data/payments.json'

export function sortPayments(payments: Payment[]) {
  return [...payments].sort((a, b) => {
    const statusOrder = Number(a.status === 'Payment Received') - Number(b.status === 'Payment Received')
    return statusOrder || b.createdAt.localeCompare(a.createdAt)
  })
}

export function paymentAttachments(payment: Payment): PaymentAttachment[] {
  if (Array.isArray(payment.attachments) && payment.attachments.length) return payment.attachments.slice(0, 10)
  if (!payment.screenshotKey && !payment.screenshotUrl) return []
  return [{ key: payment.screenshotKey || '', url: payment.screenshotUrl || '', name: payment.screenshotName || 'Payment proof', contentType: '', size: 0 }]
}

export async function listPayments() {
  const { data } = await githubReadJson<PaymentStore>(STORE_PATH, { payments: [] })
  return sortPayments(data.payments || [])
}

async function updateStore(updater: (payments: Payment[]) => Payment[]) {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await githubReadJson<PaymentStore>(STORE_PATH, { payments: [] })
    const next = { payments: updater(current.data.payments || []) }
    const body: Record<string, string> = {
      message: 'Update payments store',
      content: Buffer.from(JSON.stringify(next, null, 2)).toString('base64'),
    }
    if (current.sha) body.sha = current.sha
    try {
      await githubRequest(`/contents/${STORE_PATH}`, { method: 'PUT', body: JSON.stringify(body) })
      return next.payments
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : ''
      if (!message.includes('sha') && !message.includes('409') && !message.includes('does not match')) break
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Payment update conflict')
}

export async function createPayment(input: Omit<Payment, 'id' | 'status' | 'createdAt' | 'updatedAt'>) {
  const now = new Date().toISOString()
  const payment: Payment = { ...input, id: `payment-${crypto.randomUUID()}`, status: 'Pending', createdAt: now, updatedAt: now }
  await updateStore((payments) => [payment, ...payments])
  return payment
}

/** Creates once per key in the payment store, including across client retries. */
export async function createPublicPayment(input: Omit<Payment, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'createdBy' | 'idempotencyKey'>, idempotencyKey: string) {
  let result: Payment | undefined
  let duplicate = false
  await updateStore((payments) => {
    const existing = payments.find((payment) => payment.idempotencyKey === idempotencyKey)
    if (existing) { result = existing; duplicate = true; return payments }
    const now = new Date().toISOString()
    result = { ...input, id: `payment-${crypto.randomUUID()}`, status: 'Pending', createdBy: 'public-salesman', idempotencyKey, createdAt: now, updatedAt: now }
    return [result, ...payments]
  })
  if (!result) throw new Error('Could not create payment')
  return { payment: result, duplicate }
}

export async function deletePendingPublicPayment(id: string) {
  let deleted: Payment | null = null
  let outcome: 'deleted' | 'not-found' | 'received' = 'not-found'
  await updateStore((payments) => {
    const payment = payments.find((item) => item.id === id)
    if (!payment) return payments
    if (payment.status !== 'Pending') { outcome = 'received'; return payments }
    deleted = payment; outcome = 'deleted'
    return payments.filter((item) => item.id !== id)
  })
  return { outcome: outcome as 'deleted' | 'not-found' | 'received', payment: deleted }
}

export async function updatePaymentStatus(id: string, status: PaymentStatus) {
  let updated: Payment | null = null
  await updateStore((payments) => payments.map((payment) => {
    if (payment.id !== id) return payment
    updated = { ...payment, status, updatedAt: new Date().toISOString() }
    return updated
  }))
  return updated
}
