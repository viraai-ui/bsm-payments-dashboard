import { apiError, apiOk } from '@/lib/api'
import { requireUser } from '@/lib/auth'
import { paymentPushConfiguration, removePaymentPushSubscription, savePaymentPushSubscription } from '@/lib/payment-push'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
function validSubscription(value: unknown): value is { endpoint: string; keys: { p256dh: string; auth: string } } {
  if (!value || typeof value !== 'object') return false
  const item = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
  return typeof item.endpoint === 'string' && item.endpoint.startsWith('https://') && typeof item.keys?.p256dh === 'string' && typeof item.keys.auth === 'string'
}
const roles = ['Admin', 'Accounts', 'Salesperson', 'Viewer'] as const
export async function GET() {
  const auth = await requireUser([...roles]); if (!auth.ok) return auth.response
  return apiOk(paymentPushConfiguration())
}
export async function POST(request: Request) {
  const auth = await requireUser([...roles]); if (!auth.ok) return auth.response
  const body = await request.json().catch(() => ({}))
  if (!validSubscription(body.subscription)) return apiError('Invalid push subscription', 400)
  const deviceId = typeof body.deviceId === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(body.deviceId) ? body.deviceId : ''
  if (!deviceId) return apiError('Invalid device id', 400)
  if (!paymentPushConfiguration().configured) return apiError('Push notifications are not configured', 503)
  try { await savePaymentPushSubscription(auth.user.id, auth.user.role, deviceId, body.subscription); return apiOk({ subscribed: true }) }
  catch (error) { return apiError(error instanceof Error ? error.message : 'Could not save subscription', 500) }
}
export async function DELETE(request: Request) {
  const auth = await requireUser([...roles]); if (!auth.ok) return auth.response
  const body = await request.json().catch(() => ({})); const endpoint = String(body.endpoint || '')
  if (!endpoint.startsWith('https://')) return apiError('Invalid endpoint', 400)
  try { await removePaymentPushSubscription(auth.user.id, endpoint); return apiOk({ subscribed: false }) }
  catch (error) { return apiError(error instanceof Error ? error.message : 'Could not remove subscription', 500) }
}
