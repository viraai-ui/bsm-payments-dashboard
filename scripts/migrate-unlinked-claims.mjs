#!/usr/bin/env node
import { buildUnlinkedClaimMigration, assertSafeUnlinkedClaimMutation, contentDigest, EXPECTED_UNLINKED_COUNT } from './unlinked-claim-migration-lib.mjs'
import { getGitHubDataObject, putGitHubDataObject, githubDataConfig } from '../src/lib/github-data-store.ts'

const args=new Set(process.argv.slice(2)),apply=args.has('--apply')
if(args.has('--help')){console.log('Usage: node --env-file=.env.local --experimental-strip-types scripts/migrate-unlinked-claims.mjs [--apply]\nDefault is read-only dry-run. Apply additionally requires UNLINKED_CLAIM_MIGRATION_APPLY=YES.');process.exit(0)}
for(const arg of args)if(arg!=='--apply')throw new Error(`Unknown argument: ${arg}`)
if(apply&&process.env.UNLINKED_CLAIM_MIGRATION_APPLY!=='YES')throw new Error('Apply requires both --apply and UNLINKED_CLAIM_MIGRATION_APPLY=YES')
const objectPath='data/payments.json',source=await getGitHubDataObject(objectPath)
if(!source)throw new Error(`${objectPath} not found in production data repository`)
let store;try{store=JSON.parse(source.bytes.toString('utf8'))}catch{throw new Error(`${objectPath} is not valid JSON`)}
const {output,report}=buildUnlinkedClaimMigration(store)
if(report.unlinked!==EXPECTED_UNLINKED_COUNT||report.linked!==94||report.payments!==106)throw new Error(`Production shape guard failed: ${JSON.stringify(report)}`)
const outputBytes=Buffer.from(`${JSON.stringify(output,null,2)}\n`),summary={mode:apply?'apply':'dry-run',dataRepository:`${githubDataConfig().owner}/${githubDataConfig().repo}`,objectPath,sourceGitBlobSha:source.sha,sourceSha256:contentDigest(source.bytes),outputSha256:contentDigest(outputBytes),...report}
console.log(JSON.stringify(summary,null,2))
if(!apply)process.exit(0)
if(report.changed===0){console.log(JSON.stringify({verified:true,noOp:true,idempotent:true,gitBlobSha:source.sha},null,2));process.exit(0)}
if(report.changed!==EXPECTED_UNLINKED_COUNT)throw new Error(`Apply guard failed: expected to migrate 12 records, got ${report.changed}`)
const current=await getGitHubDataObject(objectPath)
if(!current||current.sha!==source.sha||contentDigest(current.bytes)!==contentDigest(source.bytes))throw new Error('SHA guard failed: payments.json changed since audit; rerun dry-run')
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),backupPath=`backups/payments-before-unlinked-claims-${stamp}-${source.sha.slice(0,12)}.json`
if(await getGitHubDataObject(backupPath))throw new Error(`Refusing to overwrite backup ${backupPath}`)
if(!await putGitHubDataObject(backupPath,source.bytes,`Backup payments.json before unlinked-claim migration (${source.sha})`))throw new Error('Backup write conflicted')
if(!await putGitHubDataObject(objectPath,outputBytes,`Move ${report.changed} unresolved legacy payments to Unauthorised claim queue`,source.sha))throw new Error('Production write conflicted (SHA guard)')
const verified=await getGitHubDataObject(objectPath)
if(!verified||!verified.bytes.equals(outputBytes))throw new Error('Post-write byte verification failed')
const verifiedStore=JSON.parse(verified.bytes.toString('utf8'));assertSafeUnlinkedClaimMutation(store,verifiedStore)
const rerun=buildUnlinkedClaimMigration(verifiedStore)
if(rerun.report.changed!==0||rerun.report.unlinked!==12||rerun.report.linked!==94)throw new Error(`Post-write idempotency/count verification failed: ${JSON.stringify(rerun.report)}`)
console.log(JSON.stringify({verified:true,backupPath,newGitBlobSha:verified.sha,newSha256:contentDigest(verified.bytes),productionCounts:{payments:rerun.report.payments,linked:rerun.report.linked,unlinked:rerun.report.unlinked,unauthorisedUnlinked:rerun.report.alreadyMigrated},idempotent:true,payoutEventsGenerated:0,orderLinksModified:0},null,2))
