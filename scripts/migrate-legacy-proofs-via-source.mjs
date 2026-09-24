#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { getGitHubDataObject, putGitHubDataObject } from '../src/lib/github-data-store.ts'

const apply=process.argv.includes('--apply'), sourceBase=(process.env.SOURCE_DISPATCH_URL||'https://dispatch.bsmindia.com').replace(/\/$/,'')
const targetBase=(process.env.NEXT_PUBLIC_APP_URL||'').replace(/\/$/,'')
if(apply&&process.env.LEGACY_PROOF_MIGRATION_APPLY!=='YES')throw new Error('Apply requires LEGACY_PROOF_MIGRATION_APPLY=YES')
if(!process.env.SOURCE_COOKIE&&(!process.env.SOURCE_LOGIN||!process.env.SOURCE_PASSWORD))throw new Error('SOURCE_COOKIE or SOURCE_LOGIN and SOURCE_PASSWORD are required')
const sha256=b=>createHash('sha256').update(b).digest('hex'), sleep=ms=>new Promise(r=>setTimeout(r,ms))
async function retry(label,fn){let error;for(let n=0;n<6;n++){try{return await fn()}catch(e){error=e;if(n===5)break;await sleep(1000*2**n)} }throw new Error(`${label}: ${error?.message||error}`)}
function identify(b){
 if(b.length>=3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return{mime:'image/jpeg',ext:'jpg'}
 if(b.length>=8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return{mime:'image/png',ext:'png'}
 if(b.length>=12&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')return{mime:'image/webp',ext:'webp'}
 if(b.length>=5&&b.toString('ascii',0,5)==='%PDF-')return{mime:'application/pdf',ext:'pdf'}
 if(b.length>=12&&b.toString('ascii',4,8)==='ftyp'){const brand=b.toString('ascii',8,12).toLowerCase();if(brand.includes('heic')||brand.includes('heix')||brand.includes('hevc')||brand.includes('hevx'))return{mime:'image/heic',ext:'heic'};if(brand.includes('heif')||brand.includes('mif1')||brand.includes('msf1'))return{mime:'image/heif',ext:'heif'}}
 throw new Error(`unsupported magic (${b.subarray(0,16).toString('hex')})`)
}
async function login(base){const r=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({login:process.env.SOURCE_LOGIN,password:process.env.SOURCE_PASSWORD}),redirect:'manual'});if(r.status!==200)throw new Error(`source login HTTP ${r.status}`);const raw=r.headers.get('set-cookie')||'',cookie=raw.split(';')[0];if(!cookie)throw new Error('source login returned no cookie');return cookie}
async function sourceProof(cookie,id,index){const url=`${sourceBase}/api/payments/${encodeURIComponent(id)}/proof?index=${index}`;const r=await retry(`source ${id}/${index}`,()=>fetch(url,{headers:{cookie},redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(30000)}));const bytes=Buffer.from(await r.arrayBuffer());if(r.status!==200)throw new Error(`${id}/${index}: source HTTP ${r.status}, ${bytes.length} bytes`);if(!bytes.length)throw new Error(`${id}/${index}: source returned empty bytes`);return{bytes,...identify(bytes),sourceContentType:r.headers.get('content-type')||''}}
const target=await retry('read target payments',()=>getGitHubDataObject('data/payments.json'));if(!target)throw new Error('target payments missing')
const store=JSON.parse(target.bytes), refs=[];for(const p of store.payments||[])for(const [index,a] of (p.attachments||[]).entries())refs.push({payment:p,index,attachment:a})
if(!refs.length)throw new Error('target contains no attachment references')
const legacy=refs.filter(x=>!String(x.attachment.key||'').startsWith('proofs/')), migrated=refs.filter(x=>String(x.attachment.key||'').startsWith('proofs/'))
let cookie=legacy.length?(process.env.SOURCE_COOKIE||await login(sourceBase)):'';const results=[]
for(const [n,item] of legacy.entries()){
 const {payment,index,attachment}=item
 let recovered
 try{recovered=await sourceProof(cookie,payment.id,index)}catch(error){if(!String(error?.message||error).includes('source HTTP 401')||!process.env.SOURCE_LOGIN||!process.env.SOURCE_PASSWORD)throw error;cookie=await login(sourceBase);recovered=await sourceProof(cookie,payment.id,index)}
 const {bytes,mime,ext,sourceContentType}=recovered,hash=sha256(bytes),key=`proofs/${payment.id}/${hash}.${ext}`
 if(apply){const existing=await retry(`check ${key}`,()=>getGitHubDataObject(key));if(existing){if(sha256(existing.bytes)!==hash)throw new Error(`${key}: existing hash mismatch`)}else{const ok=await retry(`upload ${key}`,()=>putGitHubDataObject(key,bytes,`Migrate legacy proof for ${payment.id}`));if(!ok)throw new Error(`${key}: create conflict`)}const check=await retry(`verify ${key}`,()=>getGitHubDataObject(key));if(!check||check.bytes.length!==bytes.length||sha256(check.bytes)!==hash)throw new Error(`${key}: GitHub read-back mismatch`);await sleep(150)}
 const oldName=String(attachment.name||'').trim(),name=oldName||`proof.${ext}`
 payment.attachments[index]={...attachment,key,url:`/api/payments/${encodeURIComponent(payment.id)}/proof?index=${index}`,name,contentType:mime,size:bytes.length}
 results.push({paymentId:payment.id,index,sourceKey:attachment.key,key,size:bytes.length,sha256:hash,mime,sourceContentType});console.log(`[${n+1}/${legacy.length}] ${payment.id}/${index} ${bytes.length} ${mime} ${hash.slice(0,12)}`)
}
const output=Buffer.from(`${JSON.stringify(store,null,2)}\n`)
console.log(JSON.stringify({mode:apply?'apply':'dry-run',targetSha:target.sha,total:refs.length,alreadyMigrated:migrated.length,legacy:legacy.length,beforeSha256:sha256(target.bytes),afterSha256:sha256(output),recovered:results.length},null,2))
if(!apply)process.exit(0)
if(legacy.length){const stamp=new Date().toISOString().replace(/[:.]/g,'-'),backupPath=`backups/legacy-proof-migration/payments-${stamp}-${target.sha.slice(0,12)}.json`;if(!await retry('backup',()=>putGitHubDataObject(backupPath,target.bytes,`Backup before legacy proof migration (${target.sha})`)))throw new Error('backup create conflict');const backup=await retry('verify backup',()=>getGitHubDataObject(backupPath));if(!backup||!backup.bytes.equals(target.bytes))throw new Error('backup verification failed');const fresh=await retry('CAS preflight',()=>getGitHubDataObject('data/payments.json'));if(!fresh||fresh.sha!==target.sha||!fresh.bytes.equals(target.bytes))throw new Error('payments CAS precondition failed');if(!await retry('payments CAS write',()=>putGitHubDataObject('data/payments.json',output,'Migrate legacy payment proofs through source Dispatch',target.sha)))throw new Error('payments CAS conflict');const final=await retry('verify payments write',()=>getGitHubDataObject('data/payments.json'));if(!final||!final.bytes.equals(output))throw new Error('payments post-write mismatch');console.log(JSON.stringify({verified:true,backupPath,newTargetSha:final.sha,objects:results.length},null,2))}
else console.log(JSON.stringify({verified:true,idempotent:true,noWrite:true},null,2))
