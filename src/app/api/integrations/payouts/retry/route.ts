import { processDueOutbox } from '@/lib/payouts-outbox'

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
