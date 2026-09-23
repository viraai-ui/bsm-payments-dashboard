import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { readAuthoritativeJson, updateLocalJson, writeLocalJson } from './local-store'
import { authKey, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from './auth-config'

export type AppRole = 'Salesperson' | 'Accounts' | 'Admin' | 'Viewer'
export type Permission = 'payments.view' | 'payments.createLinked' | 'payments.createUnauthorised' | 'payments.approve' | 'payments.claim' | 'payments.edit' | 'payments.delete' | 'users.manage' | 'roles.manage'
export type AppUser = { id: string; name: string; email: string; username: string; role: AppRole; active: boolean; passwordHash: string; createdAt: string; updatedAt: string }
export type SafeUser = Omit<AppUser, 'passwordHash'>
export type RolePermissions = Record<AppRole, Permission[]>
type UserStore = { users: AppUser[]; permissions: RolePermissions }
const FILE = 'auth-users-store.json'
export const APP_ROLES: AppRole[] = ['Salesperson', 'Accounts', 'Admin', 'Viewer']
export const ALL_PERMISSIONS: Permission[] = ['payments.view','payments.createLinked','payments.createUnauthorised','payments.approve','payments.claim','payments.edit','payments.delete','users.manage','roles.manage']
export const DEFAULT_PERMISSIONS: RolePermissions = {
  Salesperson: ['payments.view', 'payments.createLinked', 'payments.claim', 'payments.edit', 'payments.delete'],
  Accounts: ['payments.view', 'payments.createUnauthorised', 'payments.approve', 'payments.delete'],
  Admin: [...ALL_PERMISSIONS],
  Viewer: ['payments.view'],
}
const emptyStore=():UserStore=>({users:[],permissions:DEFAULT_PERMISSIONS})

async function initialStore(): Promise<UserStore> {
  const now = new Date().toISOString(), users: AppUser[] = []
  const seeds: Array<[string,string,string,AppRole]> = [
    ['Admin','admin@bsm.local','admin','Admin'], ['Accounts','accounts@bsm.local','accounts','Accounts'],
    ['Sales One','sales1@bsm.local','sales1','Salesperson'], ['Sales Two','sales2@bsm.local','sales2','Salesperson'],
    ['Sales Three','sales3@bsm.local','sales3','Salesperson'], ['Sales Four','sales4@bsm.local','sales4','Salesperson'],
    ['Sales Five','sales5@bsm.local','sales5','Salesperson'],
  ]
  for (const [name,email,username,role] of seeds) users.push({ id:`u-${username}`, name,email,username,role,active:true,passwordHash:await bcrypt.hash('ChangeMe123!',10),createdAt:now,updatedAt:now })
  return { users, permissions: DEFAULT_PERMISSIONS }
}
export async function getUserStore() {
  const local=process.env.APP_LOCAL_ONLY==='true'||(!process.env.VERCEL&&process.env.NODE_ENV!=='production')
  let store = await readAuthoritativeJson<UserStore | null>(FILE, null)
  const hasLegacyRoles = Boolean(store?.users?.some((user) => !isKnownRole(String(user.role))))
  if (local && (!store || hasLegacyRoles || !store.users.length)) {
    store = await initialStore()
    await writeLocalJson(FILE, store)
  }
  if(!store)store=emptyStore()
  // Roles are deliberately fixed in this local application. Older stores used
  // the now-retired `payments.create` permission; never let those persisted
  // arrays shadow the current safe defaults.
  return { ...store, permissions: DEFAULT_PERMISSIONS }
}
export async function saveUserStore(store: UserStore) { await writeLocalJson(FILE, store) }
export async function mutateUserStore(fn: (s: UserStore) => UserStore | Promise<UserStore>) { const local=process.env.APP_LOCAL_ONLY==='true'||(!process.env.VERCEL&&process.env.NODE_ENV!=='production');return updateLocalJson(FILE, local?await initialStore():emptyStore(), fn) }
export function safeUser({ passwordHash: _, ...user }: AppUser): SafeUser { return user }
export function isKnownRole(role: string): role is AppRole { return APP_ROLES.includes(role as AppRole) }
export async function hasPermission(user: AppUser, permission: Permission) { const s=await getUserStore(); return s.permissions[user.role]?.includes(permission) || false }
export async function findUserByLogin(login:string) { const n=login.trim().toLowerCase(); return (await getUserStore()).users.find(u=>u.email.toLowerCase()===n||u.username.toLowerCase()===n)||null }
export async function authenticate(login:string,password:string) { const u=await findUserByLogin(login); return u?.active && await bcrypt.compare(password,u.passwordHash) ? u : null }
export async function hashPassword(password:string) { return bcrypt.hash(password,10) }
export async function setSessionCookie(user:AppUser) { const token=await new SignJWT({role:user.role}).setProtectedHeader({alg:'HS256'}).setSubject(user.id).setIssuedAt().setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`).sign(authKey()); (await cookies()).set(SESSION_COOKIE_NAME,token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:SESSION_MAX_AGE_SECONDS}) }
export async function clearSessionCookie() { (await cookies()).set(SESSION_COOKIE_NAME,'',{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:0}) }
export async function getSessionUser() { try { const token=(await cookies()).get(SESSION_COOKIE_NAME)?.value; if(!token)return null; const {payload}=await jwtVerify(token,authKey()); const u=(await getUserStore()).users.find(x=>x.id===payload.sub); return u?.active?u:null } catch{return null} }
export async function requireUser(roles?:AppRole[]) { const user=await getSessionUser(); if(!user)return {ok:false as const,response:Response.json({ok:false,error:'Unauthorized'},{status:401})}; if(roles&&!roles.includes(user.role))return {ok:false as const,response:Response.json({ok:false,error:'Forbidden'},{status:403})}; return {ok:true as const,user} }
export async function requirePermission(permission:Permission) { const auth=await requireUser(); if(!auth.ok)return auth; if(!await hasPermission(auth.user,permission)) return {ok:false as const,response:Response.json({ok:false,error:'Forbidden'},{status:403})}; return auth }

export function isAdmin(role?:AppRole){return role==='Admin'}
export function isFullAccess(role?:AppRole){return role==='Admin'}
