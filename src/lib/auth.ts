import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { githubReadJson, githubWriteJson } from './workflow-store'

export type AppRole = 'Admin' | 'Operations' | 'Dispatch' | 'Media' | 'Database' | 'Accounts'
export type AppUser = {
  id: string
  name: string
  email: string
  username: string
  role: AppRole
  active: boolean
  passwordHash: string
  createdAt: string
  updatedAt: string
}
export type SafeUser = Omit<AppUser, 'passwordHash'>
type UserStore = { users: AppUser[] }

const USERS_PATH = 'data/auth-users-store.json'
const SESSION_COOKIE = 'bsm_payments_session'
const SESSION_DAYS = 365
const roles: AppRole[] = ['Admin', 'Operations', 'Dispatch', 'Media', 'Database', 'Accounts']

function secretKey() {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'bsm-payments-dashboard-local-secret-change-me'
  return new TextEncoder().encode(secret)
}

async function seedUsers(): Promise<AppUser[]> {
  const now = new Date().toISOString()
  const passwordHash = await bcrypt.hash('1231', 10)
  return [
    { id: 'u-admin', name: 'Admin', email: 'admin@bsmindia.com', username: 'admin', role: 'Admin', active: true, passwordHash, createdAt: now, updatedAt: now },
    { id: 'u-ops', name: 'Operations', email: 'operations@bsmindia.com', username: 'operations', role: 'Operations', active: true, passwordHash, createdAt: now, updatedAt: now },
    { id: 'u-dispatch', name: 'Dispatch', email: 'dispatch@bsmindia.com', username: 'dispatch', role: 'Dispatch', active: true, passwordHash, createdAt: now, updatedAt: now },
    { id: 'u-media', name: 'Media', email: 'media@bsmindia.com', username: 'media', role: 'Media', active: true, passwordHash, createdAt: now, updatedAt: now },
    { id: 'u-database', name: 'Database', email: 'database@bsmindia.com', username: 'database', role: 'Database', active: true, passwordHash: await bcrypt.hash('database', 10), createdAt: now, updatedAt: now },
    { id: 'u-accounts', name: 'Accounts', email: 'accounts@bsmindia.com', username: 'account', role: 'Accounts', active: true, passwordHash: await bcrypt.hash('account', 10), createdAt: now, updatedAt: now },
  ]
}

export function safeUser(user: AppUser): SafeUser {
  const { passwordHash: _passwordHash, ...safe } = user
  return safe
}

export function isAdmin(role?: AppRole) { return role === 'Admin' }
export function isFullAccess(role?: AppRole) { return role === 'Admin' || role === 'Operations' }
export function isKnownRole(role: string): role is AppRole { return roles.includes(role as AppRole) }

export async function getUserStore() {
  const fallback = { users: await seedUsers() }
  const { data } = await githubReadJson<UserStore>(USERS_PATH, fallback)
  if (!data.users?.length) {
    await githubWriteJson(USERS_PATH, fallback, 'Initialize dispatch users')
    return fallback
  }
  const store = { users: data.users }
  const now = new Date().toISOString()
  let changed = false
  const operations = store.users.find((user) => user.username === 'operations' || user.id === 'u-ops' || user.email === 'ops@bsmindia.com')
  if (operations && operations.email !== 'operations@bsmindia.com') { operations.email = 'operations@bsmindia.com'; operations.updatedAt = now; changed = true }
  if (!store.users.some((user) => user.role === 'Media' || user.username === 'media' || user.email === 'media@bsmindia.com')) {
    const passwordHash = await bcrypt.hash('1231', 10)
    store.users.push({ id: 'u-media', name: 'Media', email: 'media@bsmindia.com', username: 'media', role: 'Media', active: true, passwordHash, createdAt: now, updatedAt: now })
    changed = true
  }
  if (!store.users.some((user) => user.role === 'Database' || user.username === 'database' || user.email === 'database@bsmindia.com')) {
    const passwordHash = await bcrypt.hash('database', 10)
    store.users.push({ id: 'u-database', name: 'Database', email: 'database@bsmindia.com', username: 'database', role: 'Database', active: true, passwordHash, createdAt: now, updatedAt: now })
    changed = true
  }
  const accounts = store.users.find((user) => user.id === 'u-accounts' || user.username.toLowerCase() === 'account' || user.email.toLowerCase() === 'accounts@bsmindia.com')
  if (!accounts) {
    const passwordHash = await bcrypt.hash('account', 10)
    store.users.push({ id: 'u-accounts', name: 'Accounts', email: 'accounts@bsmindia.com', username: 'account', role: 'Accounts', active: true, passwordHash, createdAt: now, updatedAt: now })
    changed = true
  } else {
    const passwordMatches = await bcrypt.compare('account', accounts.passwordHash).catch(() => false)
    if (accounts.role !== 'Accounts' || accounts.username !== 'account' || !accounts.active || !passwordMatches) {
      Object.assign(accounts, { name: 'Accounts', email: 'accounts@bsmindia.com', username: 'account', role: 'Accounts' as const, active: true, passwordHash: passwordMatches ? accounts.passwordHash : await bcrypt.hash('account', 10), updatedAt: now })
      changed = true
    }
  }
  if (changed) await githubWriteJson(USERS_PATH, store, 'Update default dispatch users')
  return store
}

export async function saveUserStore(store: UserStore) {
  await githubWriteJson(USERS_PATH, store, 'Update dispatch users')
}

export async function findUserByLogin(login: string) {
  const normalized = login.trim().toLowerCase()
  const { users } = await getUserStore()
  return users.find((user) => user.email.toLowerCase() === normalized || user.username.toLowerCase() === normalized) || null
}

export async function authenticate(login: string, password: string) {
  const user = await findUserByLogin(login)
  if (!user || !user.active) return null
  const ok = await bcrypt.compare(password, user.passwordHash)
  return ok ? user : null
}

export async function createSessionToken(user: AppUser) {
  return new SignJWT({ role: user.role, email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey())
}

export async function setSessionCookie(user: AppUser) {
  const token = await createSessionToken(user)
  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_DAYS * 24 * 60 * 60 })
}

export async function clearSessionCookie() {
  const jar = await cookies()
  jar.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 })
}

export async function getSessionUser() {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secretKey())
    const userId = String(payload.sub || '')
    const { users } = await getUserStore()
    const user = users.find((item) => item.id === userId)
    return user?.active ? user : null
  } catch {
    return null
  }
}

export async function requireUser(allowed?: AppRole[]) {
  const user = await getSessionUser()
  if (!user) return { ok: false as const, response: Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) }
  if (allowed?.length && !allowed.includes(user.role)) return { ok: false as const, response: Response.json({ ok: false, error: 'Forbidden' }, { status: 403 }) }
  return { ok: true as const, user }
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10)
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE
export const APP_ROLES = roles
