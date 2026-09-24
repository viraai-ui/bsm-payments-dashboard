#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { getGitHubDataObject, putGitHubDataObject } from '../src/lib/github-data-store.ts'
import { MIGRATED_PROOFS, assertAndBuildRepair, githubProofKey, sha256 } from './migrated-proof-repair-lib.mjs'
const argv=process.argv.slice(2),apply=argv.includes('--apply'),dir=argv[argv.indexOf('--source-dir')+1]
if(!dir||argv.indexOf('--source-dir')<0)throw new Error('Usage: repair-migrated-proofs.mjs --source-dir DIR [--apply]')
if(apply&&process.env.MIGRATED_PROOF_REPAIR_APPLY!=='YES')throw new Error('Apply requires MIGRATED_PROOF_REPAIR_APPLY=YES')
const target=await getGitHubDataObject('data/payments.json');if(!target)throw new Error('Target payments missing')
const files=new Map();for(let i=0;i<MIGRATED_PROOFS.length;i++)files.set(MIGRATED_PROOFS[i].paymentId,await readFile(`${dir}/proof${i+1}.jpg`))
const {output,repairs}=assertAndBuildRepair(JSON.parse(target.bytes),files),outputBytes=Buffer.from(`${JSON.stringify(output,null,2)}\n`)
console.log(JSON.stringify({mode:apply?'apply':'dry-run',targetSha:target.sha,beforeSha256:sha256(target.bytes),afterSha256:sha256(outputBytes),repairs},null,2));if(!apply)process.exit(0)
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),backupPath=`backups/migrated-proof-repair/payments-${stamp}-${target.sha.slice(0,12)}.json`
if(!await putGitHubDataObject(backupPath,target.bytes,`Backup before migrated proof repair (${target.sha})`))throw new Error('Backup create conflict')
const backup=await getGitHubDataObject(backupPath);if(!backup||!backup.bytes.equals(target.bytes))throw new Error('Backup verification failed')
for(const spec of MIGRATED_PROOFS){const key=githubProofKey(spec),bytes=files.get(spec.paymentId),existing=await getGitHubDataObject(key);if(existing){if(sha256(existing.bytes)!==spec.sha256)throw new Error(`${key}: existing object hash differs`)}else if(!await putGitHubDataObject(key,bytes,`Migrate proof for ${spec.paymentId}`))throw new Error(`${key}: create conflict`);const verified=await getGitHubDataObject(key);if(!verified||sha256(verified.bytes)!==spec.sha256)throw new Error(`${key}: upload verification failed`)}
const fresh=await getGitHubDataObject('data/payments.json');if(!fresh||fresh.sha!==target.sha||!fresh.bytes.equals(target.bytes))throw new Error('Payments CAS precondition failed')
if(!await putGitHubDataObject('data/payments.json',outputBytes,'Repair migrated payment proof object references',target.sha))throw new Error('Payments CAS write conflict')
const verified=await getGitHubDataObject('data/payments.json');if(!verified||!verified.bytes.equals(outputBytes))throw new Error('Payments post-write verification failed')
console.log(JSON.stringify({verified:true,backupPath,newTargetSha:verified.sha,objects:repairs.length},null,2))
