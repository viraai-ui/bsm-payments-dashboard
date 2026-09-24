import { authenticate, safeUser, setSessionCookie } from '@/lib/auth'
import { checkRateLimit, clearRateLimit } from '@/lib/public-payment-security'

const fallbackBuckets=new Map<string,{count:number;reset:number}>()
function fallbackRate(request:Request){const now=Date.now(),key=request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()||'unknown',current=fallbackBuckets.get(key),bucket=!current||current.reset<=now?{count:1,reset:now+60_000}:{count:current.count+1,reset:current.reset};fallbackBuckets.set(key,bucket);return{allowed:bucket.count<=10,retryAfter:Math.max(1,Math.ceil((bucket.reset-now)/1000))}}

export async function POST(request: Request) {
  let rate;try{rate=await checkRateLimit(request,'login',10)}catch(error){console.warn('Durable login rate limit unavailable; using instance fallback',error);rate=fallbackRate(request)}if(!rate.allowed)return Response.json({ok:false,error:'Too many login attempts'},{status:429,headers:{'Retry-After':String(rate.retryAfter)}})
  const body = await request.json().catch(() => ({}))
  const login = String(body.login || body.email || '').trim()
  const password = String(body.password || '')
  if(login.length>254||password.length>1024)return Response.json({ok:false,error:'Invalid login'},{status:400})
  if (!login || !password) return Response.json({ ok: false, error: 'Email/username and password are required' }, { status: 400 })
  let user;try{user=await authenticate(login,password)}catch(error){console.error('Authentication store unavailable',error);return Response.json({ok:false,error:'Authentication is temporarily unavailable'},{status:503})}
  if (!user) return Response.json({ ok: false, error: 'Invalid login' }, { status: 401 })
  await clearRateLimit(request, 'login').catch(error=>console.warn('Could not clear durable login rate limit',error))
  await setSessionCookie(user)
  return Response.json({ ok: true, user: safeUser(user) })
}
