import { readLocalJsonFresh } from '@/lib/local-store'
import type { Payment } from '@/lib/payments'
import { linkedOrderIds, reconcileSalesOrders } from '@/lib/sales-order-reconciliation'
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60
export async function GET(request:Request){
 const secret=process.env.CRON_SECRET
 if(!secret||request.headers.get('authorization')!==`Bearer ${secret}`)return Response.json({ok:false,error:'Unauthorized'},{status:401})
 try{const store=await readLocalJsonFresh<{payments:Payment[]}>('payments.json',{payments:[]}),ids=linkedOrderIds(store.payments),baselines=Object.fromEntries(store.payments.filter(p=>p.salesOrderId).map(p=>[p.salesOrderId!,{orderTotal:p.orderTotal,customerName:p.customerName}])),results=await reconcileSalesOrders(ids,{baselines});const failed=results.filter(r=>r.status==='failed').length;return Response.json({ok:failed===0,linked:ids.length,changed:results.filter(r=>r.status==='changed').length,unchanged:results.filter(r=>r.status==='unchanged').length,failed},{status:failed?503:200})}
 catch(error){console.error('Zoho sales-order reconciliation job failed',error);return Response.json({ok:false,error:'Sales-order reconciliation is temporarily unavailable'},{status:503})}
}
