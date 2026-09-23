import { authenticate, safeUser, setSessionCookie } from '@/lib/auth'
import { checkRateLimit } from '@/lib/public-payment-security'

export async function POST(request: Request) {
  const rate=await checkRateLimit(request,'login',10);if(!rate.allowed)return Response.json({ok:false,error:'Too many login attempts'},{status:429,headers:{'Retry-After':String(rate.retryAfter)}})
  const body = await request.json().catch(() => ({}))
  const login = String(body.login || body.email || '').trim()
  const password = String(body.password || '')
  if(login.length>254||password.length>1024)return Response.json({ok:false,error:'Invalid login'},{status:400})
  if (!login || !password) return Response.json({ ok: false, error: 'Email/username and password are required' }, { status: 400 })
  let user;try{user=await authenticate(login,password)}catch(error){console.error('Authentication store unavailable',error);return Response.json({ok:false,error:'Authentication is temporarily unavailable'},{status:503})}
  if (!user) return Response.json({ ok: false, error: 'Invalid login' }, { status: 401 })
  await setSessionCookie(user)
  return Response.json({ ok: true, user: safeUser(user) })
}
