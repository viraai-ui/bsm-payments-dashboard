import { apiError, apiOk } from '@/lib/api'
import { requirePermission, requireUser } from '@/lib/auth'
import { searchPaymentOrders, synchronizePaymentOrderIndex } from '@/lib/payment-order-search'
import { orderSummary } from '@/lib/payment-settlement'
import { listPayments } from '@/lib/payments'
import { checkRateLimit } from '@/lib/public-payment-security'

export async function GET(request: Request) {
  const auth = await requirePermission('payments.view')
  if (!auth.ok) return auth.response
  try {
    const url = new URL(request.url)
    const q = String(url.searchParams.get('q') || '').slice(0, 100)
    const result = await searchPaymentOrders(q, Math.min(Number(url.searchParams.get('limit')) || (q ? 25 : 10), 50))
    const payments = await listPayments()
    const orders = result.orders.map(order => ({...order, settlement: orderSummary(payments, order.salesOrderNumber, order.orderTotal, order.id)}))
    const response=apiOk({ ...result, orders })
    response.headers.set('Cache-Control','private, no-store, max-age=0')
    response.headers.set('Vary','Cookie')
    return response
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Could not load open sales orders', 502)
  }
}

/** Explicit, salesperson-only, bounded recent lane. Search GETs never contact Zoho. */
export async function POST(request:Request){
  const auth=await requireUser(['Salesperson']);if(!auth.ok)return auth.response
  const rate=await checkRateLimit(request,`sales-order-index-refresh:${auth.user.id}`,6)
  if(!rate.allowed)return apiError('Refresh limit reached. Try again in a minute.',429)
  const result=await synchronizePaymentOrderIndex({recentOnly:true,maxPages:1})
  const url=new URL(request.url),q=String(url.searchParams.get('q')||'').slice(0,100)
  const searched=await searchPaymentOrders(q,Math.min(Number(url.searchParams.get('limit'))||25,50)),payments=await listPayments()
  const data={...searched,orders:searched.orders.map(order=>({...order,settlement:orderSummary(payments,order.salesOrderNumber,order.orderTotal,order.id) }))}
  const headers={'Cache-Control':'private, no-store'}
  if(result.error==='lease-active')return Response.json({ok:true,data:{...data,refresh:'lease-active'}},{status:202,headers})
  if(result.error==='backoff')return Response.json({ok:false,error:`Zoho is in provider backoff${result.nextEligibleAt?` until ${result.nextEligibleAt}`:''}`,data},{status:429,headers})
  if(result.error)return Response.json({ok:false,error:result.error,data},{status:502,headers})
  return Response.json({ok:true,data:{...data,refresh:'complete',callsThisRun:result.callsThisRun}},{headers})
}
