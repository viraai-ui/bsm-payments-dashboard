import { apiError, apiOk } from '@/lib/api'
import { validatePaymentOrder } from '@/lib/payment-order-search'
import { createPaymentNotifications } from '@/lib/payment-notifications'
import { notifyAccountsOfNewPayment } from '@/lib/payment-push'
import { createPublicPayment, isPaymentAddedBy, listPayments, paymentAttachments, type PaymentAttachment, type PaymentMode } from '@/lib/payments'
import { checkRateLimit, issuePaymentDeleteCapability, publicApiHeaders, sameOrigin, verifySubmissionToken } from '@/lib/public-payment-security'
import { deleteR2Object, verifyR2Object } from '@/lib/r2'
import { PAYMENT_PROOF_MIME_TYPES, PUBLIC_PAYMENT_SCREENSHOT_MAX_BYTES } from '@/lib/payment-screenshot'
import { cleanPaymentCustomerName, verifyPaymentUploadScope } from '@/lib/payment-manual'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const MODES: PaymentMode[] = ['Bank Transfer', 'UPI', 'Cash', 'Credit Card', 'Debit Card', 'Other']
const MAX_BODY = 20_000
function value(input: unknown) { return String(input || '').trim() }

/** Read-only salesman facade. Keep this deliberately narrower than the authenticated payment API. */
export async function GET(request: Request) {
  const rate = checkRateLimit(request, 'public-payment-list', 120)
  if (!rate.allowed) return publicApiHeaders(apiError('Too many requests', 429))
  try {
    const payments = (await listPayments()).map((payment) => ({
      id: payment.id,
      date: payment.createdAt,
      salesOrderNumber: payment.salesOrderNumber,
      customerName: payment.customerName,
      paymentMode: payment.paymentMode || null,
      paymentAmount: payment.paymentAmount ?? null,
      status: payment.status,
      remarks: payment.remarks || null,
      addedBy: payment.addedBy || null,
      attachments: paymentAttachments(payment).map((proof, index) => ({ name: proof.name, contentType: proof.contentType, size: proof.size, url: `/api/public/payments/${encodeURIComponent(payment.id)}/proof?index=${index}` })),
      hasScreenshot: paymentAttachments(payment).length > 0,
      proofUrl: paymentAttachments(payment).length ? `/api/public/payments/${encodeURIComponent(payment.id)}/proof` : null,
    }))
    const response = apiOk({ payments })
    response.headers.set('Cache-Control', 'no-store, max-age=0')
    return publicApiHeaders(response)
  } catch (error) {
    return publicApiHeaders(apiError(error instanceof Error ? error.message : 'Could not load payments', 500))
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return publicApiHeaders(apiError('Invalid request origin', 403))
  const length = Number(request.headers.get('content-length') || 0)
  if (length > MAX_BODY) return publicApiHeaders(apiError('Request is too large', 413))
  const rate = checkRateLimit(request, 'public-payment-submit', 8)
  if (!rate.allowed) {
    const response = apiError('Too many submissions. Please try again shortly.', 429)
    response.headers.set('Retry-After', String(rate.retryAfter))
    return publicApiHeaders(response)
  }
  const raw = await request.text().catch(() => '')
  if (Buffer.byteLength(raw) > MAX_BODY) return publicApiHeaders(apiError('Request is too large', 413))
  let body: Record<string, unknown>
  try { body = JSON.parse(raw) } catch { return publicApiHeaders(apiError('Invalid request', 400)) }
  if (value(body.website)) return publicApiHeaders(apiError('Invalid submission', 400))
  if (!verifySubmissionToken(value(body.submissionToken))) return publicApiHeaders(apiError('Form expired. Reload and try again.', 403))
  const idempotencyKey = value(request.headers.get('idempotency-key'))
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(idempotencyKey)) return publicApiHeaders(apiError('Invalid submission key', 400))
  const orderId = value(body.salesOrderId)
  const salesOrderNumber = value(body.salesOrderNumber)
  const customerName = cleanPaymentCustomerName(body.customerName)
  const linked = Boolean(orderId && salesOrderNumber)
  if (Boolean(orderId) !== Boolean(salesOrderNumber)) return publicApiHeaders(apiError('Do not submit an unselected sales order', 400))
  if (!customerName) return publicApiHeaders(apiError('Enter a valid customer name (maximum 120 characters)', 400))
  const manualScope = linked ? null : verifyPaymentUploadScope(body.uploadScope)
  if (!linked && !manualScope) return publicApiHeaders(apiError('Invalid or expired manual payment upload scope', 400))
  const amountText = value(body.paymentAmount)
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(amountText)) return publicApiHeaders(apiError('Enter a valid payment amount with up to 2 decimal places', 400))
  const paymentAmount = Number(amountText)
  if (paymentAmount <= 0 || paymentAmount > 9999999999.99) return publicApiHeaders(apiError('Payment amount is outside the allowed range', 400))
  const paymentMode = value(body.paymentMode) as PaymentMode
  if (!MODES.includes(paymentMode)) return publicApiHeaders(apiError('Select a valid payment mode', 400))
  const addedBy = body.addedBy
  if (!isPaymentAddedBy(addedBy)) return publicApiHeaders(apiError('Select a valid user who added the payment', 400))
  const screenshotKey = value(body.screenshotKey)
  const screenshotUrl = value(body.screenshotUrl)
  const screenshotName = value(body.screenshotName).slice(0, 120)
  const remarks = value(body.remarks)
  const requested = Array.isArray(body.attachments) ? body.attachments : screenshotKey ? [{ key: screenshotKey, name: screenshotName }] : []
  if (remarks.length > 500) return publicApiHeaders(apiError('Remarks must be 500 characters or fewer', 400))
  if (requested.length < 1 || requested.length > 10) return publicApiHeaders(apiError('Between 1 and 10 payment proofs are required', 400))
  if (screenshotKey && (!/^payments\/public\/[a-zA-Z0-9._/-]{1,220}$/.test(screenshotKey) || screenshotUrl !== `/api/r2/view?key=${encodeURIComponent(screenshotKey)}`)) return publicApiHeaders(apiError('Invalid screenshot reference', 400))
  const attachments: PaymentAttachment[] = []
  try {
    const order = linked ? await validatePaymentOrder(orderId, salesOrderNumber, customerName) : null
    if (linked && !order) return publicApiHeaders(apiError('Sales order details do not match Zoho. Please select it again.', 400))
    const seen = new Set<string>()
    for (const rawItem of requested) {
      const item = rawItem && typeof rawItem === 'object' ? rawItem as Record<string, unknown> : {}; const key = value(item.key)
      if (!key || seen.has(key) || !/^payments\/bsm-payments-dashboard\/public\/[a-zA-Z0-9._/-]{1,400}$/.test(key)) return publicApiHeaders(apiError('Invalid or duplicate payment proof', 400))
      seen.add(key); const metadata = await verifyR2Object(key, { prefixes: ['payments/bsm-payments-dashboard/public/'], expectedTypes: PAYMENT_PROOF_MIME_TYPES, maxBytes: PUBLIC_PAYMENT_SCREENSHOT_MAX_BYTES, order: linked ? order!.salesOrderNumber : `manual/${manualScope}` })
      attachments.push({ key, url: `/api/r2/view?key=${encodeURIComponent(key)}`, name: value(item.name).slice(0, 180) || 'Payment proof', contentType: metadata.contentType, size: metadata.contentLength })
    }
    const first = attachments[0]
    const deleteCapability = issuePaymentDeleteCapability()
    const result = await createPublicPayment({ customerName: linked ? order!.customerName : customerName, ...(linked ? { salesOrderNumber: order!.salesOrderNumber } : {}), paymentAmount, paymentMode, addedBy, remarks: remarks || undefined, attachments, screenshotKey: first?.key || screenshotKey, screenshotUrl: first?.url || screenshotUrl, screenshotName: first?.name || screenshotName, publicDeleteTokenHash: deleteCapability.hash }, idempotencyKey)
    if (result.duplicate) await Promise.allSettled(attachments.map((proof) => deleteR2Object(proof.key)))
    if (!result.duplicate) {
      await createPaymentNotifications(result.payment, 'public-salesman').catch((error) => console.error('Public payment notification failed', error))
      await notifyAccountsOfNewPayment(result.payment).catch((error) => console.error('Public payment push failed', error))
    }
    return publicApiHeaders(apiOk({ receipt: { id: result.payment.id, salesOrderNumber: result.payment.salesOrderNumber, paymentAmount: result.payment.paymentAmount, status: result.payment.status }, deleteToken: result.duplicate ? undefined : deleteCapability.token, duplicate: result.duplicate }))
  } catch (error) {
    await Promise.allSettled(attachments.map((proof) => deleteR2Object(proof.key)))
    return publicApiHeaders(apiError(error instanceof Error ? error.message : 'Could not submit payment', 500))
  }
}
