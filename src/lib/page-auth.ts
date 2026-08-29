import { requireUser, type AppRole } from './auth'

export async function hasPageAccess(allowed?: AppRole[]) {
  const auth = await requireUser(allowed)
  return auth.ok
}
