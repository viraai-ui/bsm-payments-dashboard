import { apiError, apiOk } from '@/lib/api'
import { requireUser } from '@/lib/auth'
import { listPaymentNotifications, markPaymentNotificationsRead } from '@/lib/payment-notifications'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store, max-age=0' }

export async function GET() {
  const auth = await requireUser(['Admin', 'Accounts'])
  if (!auth.ok) return auth.response
  try {
    const response = apiOk(await listPaymentNotifications(auth.user.id))
    Object.entries(noStore).forEach(([key, value]) => response.headers.set(key, value))
    return response
  } catch (error) { return apiError(error instanceof Error ? error.message : 'Could not load notifications', 500) }
}

export async function PATCH(request: Request) {
  const auth = await requireUser(['Admin', 'Accounts'])
  if (!auth.ok) return auth.response
  const body = await request.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id.trim() : undefined
  if (body.all !== true && !id) return apiError('Notification id or all is required', 400)
  try { return apiOk(await markPaymentNotificationsRead(auth.user.id, body.all === true ? undefined : id)) }
  catch (error) { return apiError(error instanceof Error ? error.message : 'Could not update notifications', 500) }
}
