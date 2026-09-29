import { apiError, apiOk } from '@/lib/api'
import { getSessionUser } from '@/lib/auth'
import { listPayments } from '@/lib/payments'
import { readPaymentOrderMirror, readPaymentOrderMirrorFresh, synchronizePaymentOrderIndex } from '@/lib/payment-order-search'
import { selectSalespersonOverview } from '@/lib/salesperson-overview'
import { checkRateLimit } from '@/lib/public-payment-security'

export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(){
 const user=await getSessionUser()
 if(!user)return apiError('Authentication required',401)
 if(user.role!=='Salesperson')return apiError('Salesperson access required',403)
 try{
  const [mirror,payments]=await Promise.all([readPaymentOrderMirror(),listPayments()])
  const response=apiOk(selectSalespersonOverview(mirror.orders,payments,user,mirror))
  response.headers.set('Cache-Control','private, no-store, max-age=0, must-revalidate')
  response.headers.set('Vary','Cookie')
  return response
 }catch(error){return apiError(error instanceof Error?error.message:'Could not load overview',500)}
}

/** Bounded, read-only-to-finance refresh of the shared sales-order mirror. */
export async function POST(request:Request){
 const user=await getSessionUser()
 if(!user)return apiError('Authentication required',401)
 if(user.role!=='Salesperson')return apiError('Salesperson access required',403)
 const rate=await checkRateLimit(request,`salesperson-overview-sync:${user.id}`,6)
 if(!rate.allowed)return apiError('Sync limit reached. Try again shortly.',429)
 try{
  const result=await synchronizePaymentOrderIndex({recentOnly:true,maxPages:1,maxMs:5000})
  if(result.error&&result.error!=='lease-active')return apiError(result.error==='backoff'?'Sync is temporarily paused. Your saved orders are still available.':result.error,503)
  const [mirror,payments]=await Promise.all([readPaymentOrderMirrorFresh(),listPayments()])
  const response=apiOk({overview:selectSalespersonOverview(mirror.orders,payments,user,mirror),coalesced:result.error==='lease-active'})
  response.headers.set('Cache-Control','private, no-store, max-age=0, must-revalidate')
  response.headers.set('Vary','Cookie')
  return response
 }catch(error){return apiError(error instanceof Error?error.message:'Could not sync overview',500)}
}
