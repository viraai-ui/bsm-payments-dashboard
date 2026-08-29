import { apiError, apiOk } from '@/lib/api'
import { createR2UploadTarget, ensureR2BrowserCors } from '@/lib/r2'
import { checkRateLimit, publicApiHeaders, sameOrigin, verifySubmissionToken } from '@/lib/public-payment-security'
import { paymentScreenshotType, PUBLIC_PAYMENT_SCREENSHOT_MAX_BYTES } from '@/lib/payment-screenshot'
import { issuePaymentUploadScope, verifyPaymentUploadScope } from '@/lib/payment-manual'

export const runtime = 'nodejs'
function safe(value: string) { return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'payment' }

export async function POST(request: Request) {
  if (!sameOrigin(request)) return publicApiHeaders(apiError('Invalid request origin', 403))
  const rate = checkRateLimit(request, 'public-payment-upload', 10)
  if (!rate.allowed) return publicApiHeaders(apiError('Too many upload requests', 429))
  if (Number(request.headers.get('content-length') || 0) > 5000) return publicApiHeaders(apiError('Request is too large', 413))
  const body = await request.json().catch(() => ({}))
  if (!verifySubmissionToken(String(body.submissionToken || ''))) return publicApiHeaders(apiError('Form expired. Reload and try again.', 403))
  const name = String(body.name || '')
  const image = paymentScreenshotType(name, String(body.type || ''))
  const size = Number(body.size)
  if (!image) return publicApiHeaders(apiError('Only a supported image or PDF is allowed (JPEG, PNG, WebP, HEIC or PDF)', 400))
  if (!Number.isSafeInteger(size) || size <= 0 || size > PUBLIC_PAYMENT_SCREENSHOT_MAX_BYTES) return publicApiHeaders(apiError('Payment proof must be non-empty and no larger than 10 MB', 400))
  try {
    const rawOrder = String(body.salesOrderNumber || '').trim()
    const suppliedScope = verifyPaymentUploadScope(body.uploadScope)
    const issued = suppliedScope ? { scope: suppliedScope, token: String(body.uploadScope) } : issuePaymentUploadScope()
    const binding = rawOrder ? safe(rawOrder) : `manual/${issued.scope}`
    const key = `payments/bsm-payments-dashboard/public/${binding}/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${crypto.randomUUID()}-${safe(name.replace(/\.[^.]+$/, ''))}.${image.extension}`
    const target = createR2UploadTarget(key, image.mimeType, 300, 3650)
    const cors = await ensureR2BrowserCors(target.uploadUrl)
    if (!cors.corsReady) return publicApiHeaders(apiError(cors.corsError, 503))
    return publicApiHeaders(apiOk({ ...target, uploadContentType: image.mimeType, uploadScope: issued.token }))
  } catch (error) { return publicApiHeaders(apiError(error instanceof Error ? error.message : 'Could not prepare upload', 500)) }
}
