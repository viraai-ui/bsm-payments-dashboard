import bcrypt from 'bcryptjs'
import { apiError, apiOk } from '@/lib/api'
import { hashPassword, mutateUserStore, requireUser, setSessionCookie } from '@/lib/auth'

const ERROR = 'Unable to change password'

export async function POST(request: Request) {
  const auth = await requireUser(['Salesperson'])
  if (!auth.ok) return auth.response
  const body = await request.json().catch(() => null)
  const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : ''
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : ''
  const confirmNewPassword = typeof body?.confirmNewPassword === 'string' ? body.confirmNewPassword : ''
  if (!currentPassword || newPassword.length < 8 || newPassword !== confirmNewPassword) return apiError(ERROR, 400)
  if (!await bcrypt.compare(currentPassword, auth.user.passwordHash)) return apiError(ERROR, 400)
  const passwordHash = await hashPassword(newPassword)
  let updated = auth.user
  try {
    await mutateUserStore(store => ({...store, users: store.users.map(user => {
      if (user.id !== auth.user.id) return user
      updated = {...user, passwordHash, sessionVersion: (user.sessionVersion || 0) + 1, updatedAt: new Date().toISOString()}
      return updated
    })}))
  } catch { return apiError(ERROR, 400) }
  await setSessionCookie(updated)
  return apiOk({changed: true})
}