import { apiError, apiOk } from '@/lib/api'
import { removePaymentNotifications } from '@/lib/payment-notifications'
import { deletePendingPublicPayment, listPayments, paymentAttachments } from '@/lib/payments'
import { checkRateLimit, publicApiHeaders, strictSameOrigin, verifyPaymentDeleteCapability, verifySubmissionToken } from '@/lib/public-payment-security'
import { deleteR2Object } from '@/lib/r2'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!strictSameOrigin(request)) return publicApiHeaders(apiError('Invalid request origin', 403))
  const rate = checkRateLimit(request, 'public-payment-delete', 20)
  if (!rate.allowed) return publicApiHeaders(apiError('Too many requests. Please try again shortly.', 429))
  const { id } = await context.params
  if (!/^payment-[0-9a-f-]{36}$/i.test(id)) return publicApiHeaders(apiError('Invalid payment ID.', 400))
  const capability = (request.headers.get('x-payment-delete-token') || '').trim()
  const submissionToken = (request.headers.get('x-public-submission-token') || '').trim()
  if (capability.length > 200 || submissionToken.length > 2000) return publicApiHeaders(apiError('Invalid authorization.', 403))

  try {
    const payment = (await listPayments()).find((item) => item.id === id)
    if (!payment) {
      if (!verifySubmissionToken(submissionToken)) return publicApiHeaders(apiError('Deletion session expired. Reload and try again.', 403))
      await removePaymentNotifications(id)
      return publicApiHeaders(apiOk({ deleted: true, alreadyDeleted: true }))
    }
    const ownsPayment = verifyPaymentDeleteCapability(capability, payment.publicDeleteTokenHash)
    if (!ownsPayment && !verifySubmissionToken(submissionToken)) return publicApiHeaders(apiError('Deletion session expired. Reload and try again.', 403))
    if (payment.status !== 'Pending') return publicApiHeaders(apiError('Payment Received records cannot be deleted.', 409))

    // Fail closed: retain the visible payment whenever proof cleanup fails.
    if (paymentAttachments(payment).some((proof) => proof.key)) {
      try { await Promise.all(paymentAttachments(payment).filter((proof) => proof.key).map((proof) => deleteR2Object(proof.key))) }
      catch { return publicApiHeaders(apiError('Could not remove the payment screenshot. Nothing was deleted; please retry.', 503)) }
    }
    const result = await deletePendingPublicPayment(id)
    if (result.outcome === 'received') return publicApiHeaders(apiError('Payment Received records cannot be deleted.', 409))
    if (result.outcome === 'not-found') return publicApiHeaders(apiOk({ deleted: true, alreadyDeleted: true }))
    await removePaymentNotifications(id)
    console.info('[public-payment-delete]', JSON.stringify({ id, salesOrderNumber: payment.salesOrderNumber, deletedAt: new Date().toISOString(), source: ownsPayment ? 'capability' : 'public-session' }))
    return publicApiHeaders(apiOk({ deleted: true }))
  } catch (error) {
    return publicApiHeaders(apiError(error instanceof Error ? error.message : 'Could not delete payment. Please retry.', 500))
  }
}
