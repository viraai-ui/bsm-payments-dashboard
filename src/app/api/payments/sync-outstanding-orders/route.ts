import { apiError, apiOk } from '@/lib/api'
import { requirePermission } from '@/lib/auth'
import { paymentReadModelForUserFresh } from '@/lib/payments'
import { syncAllOutstandingOrders } from '@/lib/sales-order-reconciliation'

export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60
let running=false
export async function POST(){
 const auth=await requirePermission('payments.view');if(!auth.ok)return auth.response
 if(running)return apiError('An outstanding-order sync is already running',409)
 running=true
 try{const summary=await syncAllOutstandingOrders(),model=await paymentReadModelForUserFresh(auth.user),response=apiOk({summary,...model});response.headers.set('Cache-Control','private, no-store');return response}
 catch(error){return apiError(error instanceof Error?error.message:'Outstanding-order sync failed',503)}finally{running=false}
}
