#!/usr/bin/env node
import { buildFinalDispatchSync, digest } from './final-dispatch-sync-lib.mjs'
import { getGitHubDataObject, putGitHubDataObject, githubDataConfig } from '../src/lib/github-data-store.ts'
import { fetchAllZohoPaymentOrders } from '../src/lib/zoho-payment-orders.ts'

const argv=process.argv.slice(2), value=name=>{const i=argv.indexOf(name);return i<0?null:argv[i+1]}, apply=argv.includes('--apply')
if(argv.includes('--help')){console.log('Usage: node --env-file=.env.local --experimental-strip-types scripts/final-dispatch-sync.mjs [--apply --source-sha SHA --target-sha SHA]\nDry-run is the default. Apply additionally requires FINAL_DISPATCH_SYNC_APPLY=YES and the exact SHAs printed by a fresh dry-run.');process.exit(0)}
const allowed=new Set(['--apply','--source-sha','--target-sha']);for(let i=0;i<argv.length;i++){if(!allowed.has(argv[i]))throw new Error(`Unknown argument: ${argv[i]}`);if(argv[i].endsWith('-sha'))i++}
if(apply&&(process.env.FINAL_DISPATCH_SYNC_APPLY!=='YES'||!value('--source-sha')||!value('--target-sha')))throw new Error('Apply requires --apply, FINAL_DISPATCH_SYNC_APPLY=YES, --source-sha, and --target-sha')
const owner=(process.env.GITHUB_OWNER||'').trim(),repo=(process.env.GITHUB_REPO||'').trim(),data=githubDataConfig()
if(!owner||!repo)throw new Error('GITHUB_OWNER and GITHUB_REPO are required');if(repo===data.repo)throw new Error('Source and target repositories must differ')
const headers={Authorization:`Bearer ${data.token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}
async function sourceObject(){const ref=process.env.GITHUB_BRANCH?`?ref=${encodeURIComponent(process.env.GITHUB_BRANCH)}`:'';const r=await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/data/payments.json${ref}`,{headers,cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`Source GitHub read failed (${r.status})`);const b=await r.json();if(b.type!=='file'||!b.sha)throw new Error('Invalid source GitHub object');let content=b.content;if(!content){const br=await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${b.sha}`,{headers,cache:'no-store',signal:AbortSignal.timeout(15000)});if(!br.ok)throw new Error(`Source blob read failed (${br.status})`);content=(await br.json()).content}return{sha:b.sha,bytes:Buffer.from(content.replace(/\n/g,''),'base64')}}
function parse(object,label){try{const value=JSON.parse(object.bytes);if(!Array.isArray(value.payments))throw 0;return value}catch{throw new Error(`${label} payments.json is invalid`)}}
const source=await sourceObject(),target=await getGitHubDataObject('data/payments.json');if(!target)throw new Error('Target data/payments.json not found')
const orders=await fetchAllZohoPaymentOrders(),{output,report}=buildFinalDispatchSync(parse(target,'target'),parse(source,'source'),orders,source.sha),outputBytes=Buffer.from(`${JSON.stringify(output,null,2)}\n`)
console.log(JSON.stringify({mode:apply?'apply':'dry-run',sourceRepository:`${owner}/${repo}`,targetRepository:`${data.owner}/${data.repo}`,sourceGitSha:source.sha,targetGitSha:target.sha,sourceSha256:digest(source.bytes),targetSha256:digest(target.bytes),outputSha256:digest(outputBytes),...report},null,2))
if(!apply)process.exit(0)
if(value('--source-sha')!==source.sha||value('--target-sha')!==target.sha)throw new Error('Explicit SHA arguments do not match this fresh read; rerun dry-run')
if(report.changed===0){console.log(JSON.stringify({verified:true,idempotent:true,noWrite:true},null,2));process.exit(0)}
const freshSource=await sourceObject(),freshTarget=await getGitHubDataObject('data/payments.json');if(freshSource.sha!==source.sha||!freshTarget||freshTarget.sha!==target.sha||digest(freshTarget.bytes)!==digest(target.bytes))throw new Error('SHA/CAS guard failed before backup; rerun dry-run')
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),backupPath=`backups/final-dispatch-sync/payments-${stamp}-${target.sha.slice(0,12)}.json`
if(await getGitHubDataObject(backupPath))throw new Error(`Backup already exists: ${backupPath}`)
if(!await putGitHubDataObject(backupPath,target.bytes,`Create-only backup before final Dispatch sync (${target.sha})`))throw new Error('Backup create conflicted')
const backup=await getGitHubDataObject(backupPath);if(!backup||!backup.bytes.equals(target.bytes))throw new Error('Backup read-back verification failed')
const prewrite=await getGitHubDataObject('data/payments.json');if(!prewrite||prewrite.sha!==target.sha||digest(prewrite.bytes)!==digest(target.bytes))throw new Error('Target changed after backup; refusing CAS write')
if(!await putGitHubDataObject('data/payments.json',outputBytes,`Final incremental Dispatch sync (${source.sha})`,target.sha))throw new Error('Target CAS write conflicted')
const verified=await getGitHubDataObject('data/payments.json');if(!verified||!verified.bytes.equals(outputBytes))throw new Error('Post-write byte verification failed')
const rerun=buildFinalDispatchSync(parse(verified,'verified target'),parse(source,'source'),orders,source.sha);if(rerun.report.changed!==0)throw new Error('Post-write idempotency check failed')
console.log(JSON.stringify({verified:true,backupPath,newTargetGitSha:verified.sha,idempotent:true},null,2))
