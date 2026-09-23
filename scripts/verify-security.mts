import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const originalCwd=process.cwd()
const originalVercel=process.env.VERCEL
const root=await mkdtemp(path.join(os.tmpdir(),'bsm-security-'))
process.chdir(root)
process.env.APP_LOCAL_ONLY='true'

try {
  const security=await import('../src/lib/public-payment-security.ts')
  const spoofed=new Request('http://localhost',{headers:{'x-forwarded-for':'203.0.113.10','x-real-ip':'203.0.113.11'}})
  delete process.env.VERCEL
  assert.equal(security.clientIp(spoofed),'unknown','untrusted forwarding headers must not select a rate-limit bucket')

  process.env.VERCEL='1'
  const trusted=new Request('https://example.test',{headers:{'x-forwarded-for':'203.0.113.10','x-vercel-forwarded-for':'198.51.100.7'}})
  assert.equal(security.clientIp(trusted),'198.51.100.7','Vercel trusted client IP must win over spoofable x-forwarded-for')
  const first=await security.checkRateLimit(trusted,'security-test',2)
  const second=await security.checkRateLimit(trusted,'security-test',2)
  const third=await security.checkRateLimit(trusted,'security-test',2)
  assert.equal(first.allowed,true)
  assert.equal(second.allowed,true)
  assert.equal(third.allowed,false)
  const persisted=JSON.parse(await readFile(path.join(root,'data','rate-limits.json'),'utf8')) as {buckets:Record<string,{count:number}>}
  assert.equal(Object.keys(persisted.buckets).length,1)
  assert.equal(Object.values(persisted.buckets)[0]?.count,3,'rate-limit state must be durable rather than process-only')
  console.log('PASS security: spoofable forwarding headers ignored; trusted Vercel IP used; durable limit enforced')
} finally {
  process.chdir(originalCwd)
  if(originalVercel===undefined)delete process.env.VERCEL;else process.env.VERCEL=originalVercel
  delete process.env.APP_LOCAL_ONLY
}