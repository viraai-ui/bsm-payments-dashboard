#!/usr/bin/env node
import { buildBackfill, assertSafeMutation, contentDigest } from './payment-link-backfill-lib.mjs'
import { getGitHubDataObject, putGitHubDataObject, githubDataConfig } from '../src/lib/github-data-store.ts'
import { fetchAllZohoPaymentOrders } from '../src/lib/zoho-payment-orders.ts'
import { readFile } from 'node:fs/promises'

const args=new Set(process.argv.slice(2)),apply=args.has('--apply')
if(args.has('--help')){console.log('Usage: node --env-file=.env.local --experimental-strip-types scripts/payment-link-backfill.mjs [--apply]\nDefault is read-only dry-run. --apply creates a backup and uses a source SHA concurrency guard.');process.exit(0)}
for(const arg of args)if(arg!=='--apply')throw new Error(`Unknown argument: ${arg}`)
if(apply&&process.env.PAYMENT_LINK_BACKFILL_APPLY!=='YES')throw new Error('Apply requires both --apply and PAYMENT_LINK_BACKFILL_APPLY=YES')

const objectPath='data/payments.json',source=await getGitHubDataObject(objectPath)
if(!source)throw new Error(`${objectPath} not found in production data repository`)
let store
try{store=JSON.parse(source.bytes.toString('utf8'))}catch{throw new Error(`${objectPath} is not valid JSON`)}
const orders=await fetchAllZohoPaymentOrders()
const reviewedMapping=JSON.parse(await readFile(new URL('./reviewed-payment-link-mapping.json',import.meta.url),'utf8'))
const {output,report}=buildBackfill(store,orders,reviewedMapping)
if(report.payments!==106||report.reviewedLinked!==8||report.totalLinked!==94||report.unlinkedWithoutNumber!==12||report.candidates!==94)throw new Error(`Exact-count guard failed: ${JSON.stringify(report)}`)
const outputBytes=Buffer.from(`${JSON.stringify(output,null,2)}\n`)
const summary={mode:apply?'apply':'dry-run',dataRepository:`${githubDataConfig().owner}/${githubDataConfig().repo}`,objectPath,sourceGitBlobSha:source.sha,sourceSha256:contentDigest(source.bytes),outputSha256:contentDigest(outputBytes),...report}
console.log(JSON.stringify(summary,null,2))
if(!apply)process.exit(0)

// Re-read immediately before any writes: stale audits must never mutate production.
const current=await getGitHubDataObject(objectPath)
if(!current||current.sha!==source.sha||contentDigest(current.bytes)!==contentDigest(source.bytes))throw new Error('SHA guard failed: payments.json changed since audit; rerun dry-run')
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),backupPath=`backups/payments-${stamp}-${source.sha.slice(0,12)}.json`
const backupExisting=await getGitHubDataObject(backupPath)
if(backupExisting)throw new Error(`Refusing to overwrite backup ${backupPath}`)
if(!await putGitHubDataObject(backupPath,source.bytes,`Backup payments.json before payment-link backfill (${source.sha})`))throw new Error('Backup write conflicted')
if(!await putGitHubDataObject(objectPath,outputBytes,`Backfill authoritative Zoho payment links (${report.changed} records)`,source.sha))throw new Error('Production write conflicted (SHA guard)')
const verified=await getGitHubDataObject(objectPath)
if(!verified||!verified.bytes.equals(outputBytes))throw new Error('Post-write byte verification failed')
const verifiedStore=JSON.parse(verified.bytes.toString('utf8'));assertSafeMutation(store,verifiedStore)
const rerun=buildBackfill(verifiedStore,orders,reviewedMapping)
if(rerun.report.changed!==0)throw new Error(`Post-write idempotency verification failed (${rerun.report.changed} changes remain)`)
console.log(JSON.stringify({verified:true,backupPath,newGitBlobSha:verified.sha,idempotent:true},null,2))
