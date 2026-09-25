import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
process.env.GITHUB_OWNER='acme';process.env.GITHUB_TOKEN='secret';process.env.GITHUB_REPO='payments-app';process.env.GITHUB_DATA_REPO='payments-data';process.env.GITHUB_DATA_BRANCH='main';process.env.APP_LOCAL_ONLY='false'
process.env.VERCEL='1';process.env.AUTH_SECRET='quota-regression-secret-that-is-at-least-32-bytes'
const password='regression-password-never-used-in-production',now=new Date().toISOString()
const expected=JSON.stringify({users:[{id:'u-ram',name:'Ram',email:'ram@example.test',username:'ram',role:'Salesperson',active:true,passwordHash:await bcrypt.hash(password,4),createdAt:now,updatedAt:now}],permissions:{}})
let rest=0,graphql=0
globalThis.fetch=async(url,init={})=>{
  if(String(url).endsWith('/graphql')){graphql++;const body=JSON.parse(String(init.body));assert.equal(body.variables.expression,'main:data/auth-users-store.json');return Response.json({data:{repository:{object:{oid:'abc123',byteSize:expected.length,text:expected,isBinary:false}}}})}
  rest++;return Response.json({message:'API rate limit exceeded for user ID 1'},{status:403})
}
const {getGitHubDataObject}=await import('../src/lib/github-data-store.ts')
const object=await getGitHubDataObject('data/auth-users-store.json')
assert.equal(rest,1);assert.equal(graphql,1);assert.equal(object?.bytes.toString(),expected);assert.equal(object?.sha,'abc123')
const {authenticate}=await import('../src/lib/auth.ts')
assert.equal((await authenticate('ram',password))?.id,'u-ram')
assert.equal(await authenticate('ram','wrong-password'),null)
assert.equal(rest,3);assert.equal(graphql,3)
console.log('PASS quota-resilient authentication: REST 403 uses authoritative GraphQL JSON, valid password succeeds, wrong password fails')
