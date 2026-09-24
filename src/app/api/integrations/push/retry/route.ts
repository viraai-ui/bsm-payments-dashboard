import { processDuePushOutbox, pushDeliveryAudit } from '@/lib/payment-push'

export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(request:Request){
 const secret=process.env.CRON_SECRET
 if(!secret||request.headers.get('authorization')!==`Bearer ${secret}`)return Response.json({ok:false,error:'Unauthorized'},{status:401})
 try{const results=await processDuePushOutbox();const audit=await pushDeliveryAudit();return Response.json({ok:true,processed:results.length,results:results.map(item=>({id:item.id,eventId:item.eventId,status:item.status,attempts:item.attempts,delivered:item.deliveries.filter(d=>d.status==='delivered').length})),audit})}
 catch(error){console.error('Push outbox cron failed',error);return Response.json({ok:false,error:'Push delivery is temporarily unavailable'},{status:503})}
}