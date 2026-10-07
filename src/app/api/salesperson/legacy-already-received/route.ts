import { apiError, apiOk } from '@/lib/api'
import { getSessionUser, isSalesRole } from '@/lib/auth'
import { canonicalSalesOrderNumber, markLegacySalesOrderAlreadyReceived } from '@/lib/legacy-sales-order-exclusions'
import { listPayments } from '@/lib/payments'
import { readPaymentOrderMirrorFresh } from '@/lib/payment-order-search'

export const runtime='nodejs'
export const dynamic='force-dynamic'

export async function POST(request:Request){
 const user=await getSessionUser()
 if(!user)return apiError('Authentication required',401)
 if(!isSalesRole(user.role))return apiError('Salesperson access required',403)
 try{
  const body=await request.json() as {salesOrderId?:unknown;salesOrderNumber?:unknown}
  const id=String(body.salesOrderId||'').trim(),number=String(body.salesOrderNumber||'').trim()
  if(!id||!number)return apiError('Sales order ID and number are required',400)
  const [mirror,payments]=await Promise.all([readPaymentOrderMirrorFresh(),listPayments()])
  const order=mirror.orders.find(item=>item.id===id&&canonicalSalesOrderNumber(item.salesOrderNumber)===canonicalSalesOrderNumber(number))
  if(!order)return apiError('Sales order not found',404)
  return apiOk(await markLegacySalesOrderAlreadyReceived(order,payments,user))
 }catch(error){const status=typeof (error as {status?:unknown})?.status==='number'?(error as {status:number}).status:500;return apiError(error instanceof Error?error.message:'Could not mark sales order',status)}
}