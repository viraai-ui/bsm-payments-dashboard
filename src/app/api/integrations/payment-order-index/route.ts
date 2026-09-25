import { synchronizePaymentOrderIndex } from '@/lib/payment-order-search'

export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=300

export async function GET(request:Request){
  const secret=process.env.CRON_SECRET
  if(!secret||request.headers.get('authorization')!==`Bearer ${secret}`)return Response.json({ok:false,error:'Unauthorized'},{status:401})
  try{return Response.json({ok:true,...await synchronizePaymentOrderIndex()},{headers:{'Cache-Control':'private, no-store'}})}
  catch(error){console.error('Payment sales-order index synchronization failed',error);return Response.json({ok:false,error:'Sales-order index synchronization is temporarily unavailable'},{status:503})}
}