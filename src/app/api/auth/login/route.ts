import { authenticate, safeUser, setSessionCookie } from '@/lib/auth'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const login = String(body.login || body.email || '').trim()
  const password = String(body.password || '')
  if (!login || !password) return Response.json({ ok: false, error: 'Email/username and password are required' }, { status: 400 })
  const user = await authenticate(login, password)
  if (!user) return Response.json({ ok: false, error: 'Invalid login' }, { status: 401 })
  await setSessionCookie(user)
  return Response.json({ ok: true, user: safeUser(user) })
}
