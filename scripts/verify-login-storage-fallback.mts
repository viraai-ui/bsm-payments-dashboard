import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
process.env.GITHUB_OWNER='acme';process.env.GITHUB_TOKEN='secret';process.env.GITHUB_REPO='payments-app';process.env.GITHUB_DATA_REPO='payments-data';process.env.GITHUB_DATA_BRANCH='main';process.env.APP_LOCAL_ONLY='false'
process.env.VERCEL='1';process.env.AUTH_SECRET='quota-regression-secret-that-is-at-least-32-bytes'
const password='regression-password-never-used-in-production',now=new Date().toISOString()
const expected=JSON.stringify({users:[{id:'u-ram',name:'Ram',email:'ram@example.test',username:'ram',role:'Salesperson',active:true,passwordHash:await bcrypt.hash(password,4),createdAt:now,updatedAt:now}],permissions:{}})
let rest=0,graphql=0,refs=0,raw=0
const commit='a'.repeat(40)
globalThis.fetch=async(url,init={})=>{
  const target=String(url)
  if(target.endsWith('/graphql')){graphql++;return Response.json({errors:[{message:'API rate limit already exceeded for user ID 1.'}]})}
  if(target.includes('.git/info/refs')){refs++;assert.match(String((init.headers as Record<string,string>).Authorization),/^Basic /);const payload=`${commit} refs/heads/main\0multi_ack\n`,packet=(payload.length+4).toString(16).padStart(4,'0')+payload;return new Response(`001e# service=git-upload-pack\n0000${packet}0000`,{headers:{'content-type':'application/x-git-upload-pack-advertisement'}})}
  if(target.startsWith('https://raw.githubusercontent.com/')){raw++;assert.match(target,new RegExp(`/${commit}/data/auth-users-store.json$`));return new Response(expected)}
  rest++;return Response.json({message:'API rate limit exceeded for user ID 1'},{status:403})
}
const {getGitHubDataObject}=await import('../src/lib/github-data-store.ts')
const object=await getGitHubDataObject('data/auth-users-store.json')
assert.equal(rest,1);assert.equal(graphql,1);assert.equal(refs,1);assert.equal(raw,1);assert.equal(object?.bytes.toString(),expected);assert.match(object?.sha||'',/^[0-9a-f]{40}$/)
const {authenticate}=await import('../src/lib/auth.ts')
assert.equal((await authenticate('ram',password))?.id,'u-ram')
assert.equal(await authenticate('ram','wrong-password'),null)
assert.equal(rest,3);assert.equal(graphql,3);assert.equal(refs,3);assert.equal(raw,3)
console.log('PASS quota-resilient authentication: REST and GraphQL quota exhaustion uses authenticated commit-pinned Git read; valid password succeeds, wrong password fails')
