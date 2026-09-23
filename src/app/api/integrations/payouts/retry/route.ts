import { requireUser } from '@/lib/auth'
import { listOutbox, processDueOutbox, retryOutboxEvent } from '@/lib/payouts-outbox'

export const runtime='nodejs'
export const dynamic='force-dynamic'

function cronAuthorized(request:Request){
  const secret=process.env.CRON_SECRET
  return Boolean(secret&&request.headers.get('authorization')===`Bearer ${secret}`)
}

/** Vercel Cron entrypoint. The browser never receives either integration secret. */
export async function GET(request:Request){
  if(!cronAuthorized(request))return Response.json({ok:false,error:'Unauthorized'},{status:401})
  try{const results=await processDueOutbox();return Response.json({ok:true,processed:results.length,results:results.map(item=>({eventId:item.eventId,status:item.status,outcome:item.outcome,attempts:item.attempts,nextAttemptAt:item.nextAttemptAt}))})}
  catch(error){console.error('Payout outbox cron failed',error);return Response.json({ok:false,error:'Payout synchronization is temporarily unavailable'},{status:503})}
}

/** Admin inspection/manual retry. Omit eventId to inspect sanitized synchronization state. */
export async function POST(request:Request){
  const auth=await requireUser(['Admin']);if(!auth.ok)return auth.response
  try{const body=await request.json().catch(()=>({})) as {eventId?:unknown}
  if(typeof body.eventId!=='string'||!body.eventId.trim()){
    const events=await listOutbox()
    return Response.json({ok:true,events:events.map(item=>({eventId:item.eventId,paymentId:item.event.payment.id,type:item.event.type,status:item.status,outcome:item.outcome,attempts:item.attempts,nextAttemptAt:item.nextAttemptAt,lastHttpStatus:item.lastHttpStatus,updatedAt:item.updatedAt}))})
  }
  const result=await retryOutboxEvent(body.eventId.trim())
  return result?Response.json({ok:true,event:{eventId:result.eventId,status:result.status,outcome:result.outcome,attempts:result.attempts,nextAttemptAt:result.nextAttemptAt,lastHttpStatus:result.lastHttpStatus}}):Response.json({ok:false,error:'Event not found or is already being delivered'},{status:404})
  }catch(error){console.error('Payout outbox admin action failed',error);return Response.json({ok:false,error:'Payout synchronization is temporarily unavailable'},{status:503})}
}
