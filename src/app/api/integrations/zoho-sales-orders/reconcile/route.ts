import { readLocalJsonFresh } from '@/lib/local-store'
import type { Payment } from '@/lib/payments'
import { linkedOrderIds, readSalesOrderSnapshots, reconciliationSelection, reconcileSalesOrders } from '@/lib/sales-order-reconciliation'
import { zohoCircuitStatus } from '@/lib/zoho-circuit'
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60
export async function GET(request:Request){
 const secret=process.env.CRON_SECRET
 if(!secret||request.headers.get('authorization')!==`Bearer ${secret}`)return Response.json({ok:false,error:'Unauthorized'},{status:401})
 try{const store=await readLocalJsonFresh<{payments:Payment[]}>('payments.json',{payments:[]}),index=await readLocalJsonFresh<{orders:Record<string,unknown>}>('payment-order-index.json',{orders:{}}),ids=linkedOrderIds(store.payments),snapshots=await readSalesOrderSnapshots(),selection=reconciliationSelection(ids,Object.keys(index.orders||{}),snapshots,10),circuit=await zohoCircuitStatus();if(circuit.nextEligibleAt&&Date.parse(circuit.nextEligibleAt)>Date.now())return Response.json({ok:true,linked:ids.length,attempted:0,skipped:selection.skipped.length,skipReason:selection.skipped.length?selection.skipReason:undefined,deferred:selection.batch.length,deferReason:'provider-backoff',nextEligibleAt:circuit.nextEligibleAt,changed:0,unchanged:0,failed:0});const baselines=Object.fromEntries(store.payments.filter(p=>p.salesOrderId).map(p=>[p.salesOrderId!,{orderTotal:p.orderTotal,customerName:p.customerName}])),results=await reconcileSalesOrders(selection.batch,{baselines});const failed=results.filter(r=>r.status==='failed').length;return Response.json({ok:failed===0,linked:ids.length,attempted:selection.batch.length,skipped:selection.skipped.length,skipReason:selection.skipped.length?selection.skipReason:undefined,changed:results.filter(r=>r.status==='changed').length,unchanged:results.filter(r=>r.status==='unchanged').length,failed},{status:failed?503:200})}
 catch(error){console.error('Zoho sales-order reconciliation job failed',error);return Response.json({ok:false,error:'Sales-order reconciliation is temporarily unavailable'},{status:503})}
}
