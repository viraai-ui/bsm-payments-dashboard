import { apiError, apiOk } from '@/lib/api'
import { createAdjustment } from '@/lib/payments'
import { getUserStore, isSalesRole, requirePermission } from '@/lib/auth'
import { searchPaymentOrders, validatePaymentOrder } from '@/lib/payment-order-search'
import { salespersonOwnsOrder } from '@/lib/salesperson-overview'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const text = (value: unknown) => String(value || '').trim()

async function selectedOrder(id: unknown, number: unknown) {
  const so = text(number)
  if (!so) return null
  if (text(id)) return validatePaymentOrder(text(id), so)
  const found = (await searchPaymentOrders(so, 50)).orders.filter(order => order.salesOrderNumber === so)
  return found.length === 1 ? found[0] : null
}

export async function POST(request: Request) {
  const auth = await requirePermission('payments.createLinked')
  if (!auth.ok) return auth.response
  // Keep this accounting capability explicitly limited even if role permissions change.
  if (auth.user.role !== 'Admin' && !isSalesRole(auth.user.role)) return apiError('Forbidden', 403)
  const body = await request.json().catch(() => null)
  if (!body) return apiError('JSON body is required', 400)
  const key = text(body.idempotencyKey)
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) return apiError('A valid submission key is required', 400)
  const rawAmount = typeof body.amount === 'number' ? String(body.amount) : text(body.amount)
  if (!/^[+-]?(?:\d+)(?:\.\d{1,2})?$/.test(rawAmount)) return apiError('Enter a signed adjustment amount with at most two decimals', 400)
  const amount = Number(rawAmount)
  if (!Number.isFinite(amount) || amount === 0 || !Number.isSafeInteger(Math.round(amount * 100))) return apiError('Adjustment amount must be non-zero', 400)
  const reason = text(body.reason)
  if (!reason || reason.length > 500) return apiError('Adjustment reason is required and must be 500 characters or fewer', 400)
  const order = await selectedOrder(body.salesOrderId, body.salesOrderNumber)
  if (!order) return apiError('Select a valid authoritative sales order', 400)
  if (isSalesRole(auth.user.role) && !salespersonOwnsOrder(order, auth.user)) return apiError('This sales order does not belong to your account', 403)

  let owner = auth.user
  if (auth.user.role === 'Admin') {
    const users = (await getUserStore()).users
    const selected = users.find(user => user.id === text(body.ownerUserId) && user.active && isSalesRole(user.role))
    if (!selected) return apiError('Select an active salesperson', 400)
    if (!salespersonOwnsOrder(order, selected)) return apiError('This sales order does not belong to the selected salesperson', 403)
    owner = selected
  }
  try {
    const result = await createAdjustment({
      customerName: order.customerName,
      salesOrderId: order.id,
      salesOrderNumber: order.salesOrderNumber,
      orderTotal: order.orderTotal,
      salesOrderDate: order.orderDate,
      adjustmentAmount: amount,
      adjustmentReason: reason,
      createdBy: auth.user.id,
      ownerUserId: owner.id,
      addedBy: owner.username || owner.name,
      salespersonName: owner.name,
    }, key)
    const response = apiOk(result)
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Could not save adjustment', 400)
  }
}
