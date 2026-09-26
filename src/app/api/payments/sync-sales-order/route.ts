import { apiError, apiOk } from '@/lib/api'
import { requireUser } from '@/lib/auth'
import { paymentReadModelForUserFresh } from '@/lib/payments'
import { SyncLimitError, syncPaymentSalesOrder } from '@/lib/sales-order-manual-sync'
import { ZohoBackoffError, zohoCircuitStatus } from '@/lib/zoho-circuit'
export const runtime='nodejs';export const dynamic='force-dynamic'
export async function POST(request:Request){const auth=await requireUser(['Salesperson']);if(!auth.ok)return auth.response
 const body=await request.json().catch(()=>null),paymentId=typeof body?.paymentId==='string'?body.paymentId.trim():''
 if(!paymentId||Object.keys(body||{}).some(k=>k!=='paymentId'))return apiError('Only a valid payment id is accepted',400)
 try{const result=await syncPaymentSalesOrder(paymentId,auth.user.id),model=await paymentReadModelForUserFresh(auth.user),response=apiOk({...result,...model,message:result.changed?'Updated':'Already up to date'});response.headers.set('Cache-Control','private, no-store');return response}
 catch(error){const circuit=await zohoCircuitStatus().catch(()=>null),retry=error instanceof SyncLimitError?error.retryAfter:error instanceof ZohoBackoffError&&error.nextEligibleAt?Math.max(1,Math.ceil((Date.parse(error.nextEligibleAt)-Date.now())/1000)):circuit?.nextEligibleAt?Math.max(1,Math.ceil((Date.parse(circuit.nextEligibleAt)-Date.now())/1000)):0;const status=error instanceof SyncLimitError?error.status:error instanceof ZohoBackoffError?503:Number((error as any)?.status)||((circuit?.failureClass==='quota')?429:503);const response=apiError(error instanceof Error?error.message:'Sales order sync failed',status);if(retry)response.headers.set('Retry-After',String(retry));return response}
}