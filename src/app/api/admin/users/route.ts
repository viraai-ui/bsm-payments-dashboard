import { apiError, apiOk } from '@/lib/api'
import { ALL_PERMISSIONS, getUserStore, hashPassword, isKnownRole, mutateUserStore, requirePermission, safeUser } from '@/lib/auth'

const clean=(value:unknown)=>String(value||'').trim()
const activeAdmins=(users:Awaited<ReturnType<typeof getUserStore>>['users'])=>users.filter(user=>user.active&&user.role==='Admin')

export async function GET(){
  const auth=await requirePermission('users.manage');if(!auth.ok)return auth.response
  const store=await getUserStore()
  return apiOk({users:store.users.map(safeUser),permissions:store.permissions,allPermissions:ALL_PERMISSIONS,currentUserId:auth.user.id})
}

export async function POST(request:Request){
  const auth=await requirePermission('users.manage');if(!auth.ok)return auth.response
  const body=await request.json().catch(()=>({})),role=clean(body.role),name=clean(body.name),email=clean(body.email),username=clean(body.username),password=clean(body.password)
  if(!name||!email||!username||!isKnownRole(role)||password.length<8)return apiError('Name, unique email/username, valid role and password (8+ characters) required',400)
  const passwordHash=await hashPassword(password),now=new Date().toISOString();let made:Awaited<ReturnType<typeof getUserStore>>['users'][number]|undefined
  try{await mutateUserStore(store=>{if(store.users.some(user=>user.email.toLowerCase()===email.toLowerCase()||user.username.toLowerCase()===username.toLowerCase()))throw new Error('Email or username already exists');made={id:`u-${crypto.randomUUID()}`,name,email,username,role,active:true,passwordHash,createdAt:now,updatedAt:now};return{...store,users:[...store.users,made]}})}catch(error){return apiError(error instanceof Error?error.message:'Could not add user',400)}
  return apiOk({user:safeUser(made!)})
}

export async function PATCH(request:Request){
  const auth=await requirePermission('users.manage');if(!auth.ok)return auth.response
  const body=await request.json().catch(()=>({})),id=clean(body.id),password=clean(body.password)
  if(!id)return apiError('User id is required',400)
  if(password&&password.length<8)return apiError('Password must be at least 8 characters',400)
  const passwordHash=password?await hashPassword(password):undefined
  try{let updated=false;await mutateUserStore(store=>{
    const target=store.users.find(user=>user.id===id);if(!target)throw new Error('User not found')
    const role=body.role===undefined?target.role:clean(body.role);if(!isKnownRole(role))throw new Error('Invalid role')
    const name=body.name===undefined?target.name:clean(body.name),email=body.email===undefined?target.email:clean(body.email),username=body.username===undefined?target.username:clean(body.username)
    if(!name||!email||!username)throw new Error('Name, email and username are required')
    if(store.users.some(user=>user.id!==id&&(user.email.toLowerCase()===email.toLowerCase()||user.username.toLowerCase()===username.toLowerCase())))throw new Error('Email or username already exists')
    const active=typeof body.active==='boolean'?body.active:target.active
    if(target.role==='Admin'&&target.active&&(!active||role!=='Admin')&&activeAdmins(store.users).length===1)throw new Error('The last active admin cannot be deactivated or demoted')
    updated=true;return{...store,users:store.users.map(user=>user.id===id?{...user,name,email,username,role,active,passwordHash:passwordHash||user.passwordHash,sessionVersion:passwordHash?(user.sessionVersion||0)+1:user.sessionVersion,updatedAt:new Date().toISOString()}:user)}
  });return updated?apiOk({}):apiError('User not found',404)}catch(error){return apiError(error instanceof Error?error.message:'Could not update user',400)}
}

export async function DELETE(request:Request){
  const auth=await requirePermission('users.manage');if(!auth.ok)return auth.response
  const id=new URL(request.url).searchParams.get('id')||''
  if(!id)return apiError('User id is required',400)
  if(id===auth.user.id)return apiError('You cannot delete your own account',400)
  try{await mutateUserStore(store=>{const target=store.users.find(user=>user.id===id);if(!target)throw new Error('User not found');if(target.role==='Admin'&&target.active&&activeAdmins(store.users).length===1)throw new Error('The last active admin cannot be deleted');return{...store,users:store.users.filter(user=>user.id!==id)}});return apiOk({deleted:true})}catch(error){return apiError(error instanceof Error?error.message:'Could not delete user',400)}
}
