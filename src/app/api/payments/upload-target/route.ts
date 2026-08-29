import { apiError, apiOk } from '@/lib/api'
import { requireUser } from '@/lib/auth'
import { createR2UploadTarget, ensureR2BrowserCors } from '@/lib/r2'
import { INTERNAL_PAYMENT_SCREENSHOT_MAX_BYTES, paymentScreenshotType } from '@/lib/payment-screenshot'
import { issuePaymentUploadScope, verifyPaymentUploadScope } from '@/lib/payment-manual'

export const runtime = 'nodejs'

function safe(value: string) { return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'payment' }

export async function POST(request: Request) {
  const auth = await requireUser(['Admin'])
  if (!auth.ok) return auth.response
  try {
    const body = await request.json().catch(() => ({}))
    const name = String(body.name || '')
    const image = paymentScreenshotType(name, String(body.type || ''))
    const size = Number(body.size)
    const salesOrderNumber = String(body.salesOrderNumber || '').trim()
    if (!image) return apiError('Only a supported image or PDF is allowed (JPEG, PNG, WebP, HEIC or PDF)', 400)
    if (!Number.isSafeInteger(size) || size <= 0 || size > INTERNAL_PAYMENT_SCREENSHOT_MAX_BYTES) return apiError('Payment proof must be non-empty and no larger than 10 MB', 400)
    const suppliedScope = verifyPaymentUploadScope(body.uploadScope)
    const issued = suppliedScope ? { scope: suppliedScope, token: String(body.uploadScope) } : issuePaymentUploadScope()
    const binding = salesOrderNumber ? safe(salesOrderNumber) : `manual/${issued.scope}`
    const key = `payments/${binding}/${Date.now()}-${crypto.randomUUID()}.${image.extension}`
    const target = createR2UploadTarget(key, image.mimeType, 900, 3650)
    const cors = await ensureR2BrowserCors(target.uploadUrl)
    if (!cors.corsReady) return apiError(cors.corsError, 503)
    return apiOk({ ...target, uploadContentType: image.mimeType, uploadScope: issued.token })
  } catch (error) { return apiError(error instanceof Error ? error.message : 'Could not prepare screenshot upload', 400) }
}
