import { synchronizePaymentOrderIndex } from '@/lib/payment-order-search'

export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=60

export async function GET(request:Request){
  const secret=process.env.CRON_SECRET
  if(!secret||request.headers.get('authorization')!==`Bearer ${secret}`)return Response.json({ok:false,error:'Unauthorized'},{status:401})
  try{
    const source=request.headers.get('x-vercel-cron')==='1'?'vercel-cron':'authorized-request'
    const result=await synchronizePaymentOrderIndex({recentOnly:true,maxPages:1,maxMs:45_000})
    const unavailable=result.error&&result.error!=='lease-active'
    const payload={ok:!unavailable,source,...result}
    if(unavailable)console.error('payment-order-index unhealthy',payload)
    else console.info('payment-order-index synchronized',payload)
    return Response.json(payload,{status:unavailable?503:200,headers:{'Cache-Control':'private, no-store'}})
  }
  catch(error){console.error('Payment sales-order index synchronization failed',error);return Response.json({ok:false,error:'Sales-order index synchronization is temporarily unavailable'},{status:503})}
}