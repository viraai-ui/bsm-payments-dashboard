import { getSessionUser, safeUser } from '@/lib/auth'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return Response.json({ ok: false, user: null }, { status: 401 })
  return Response.json({ ok: true, user: safeUser(user) })
}
