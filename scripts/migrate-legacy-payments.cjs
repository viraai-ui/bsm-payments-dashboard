#!/usr/bin/env node
'use strict'
const fs=require('fs'), path=require('path'), crypto=require('crypto')
const [sourcePath, backupRoot, sourceCommit, expectedHash, runStamp]=process.argv.slice(2)
if(!sourcePath||!backupRoot||!sourceCommit||!expectedHash||!runStamp){console.error('usage: node scripts/migrate-legacy-payments.cjs SOURCE BACKUP_ROOT SOURCE_COMMIT SOURCE_SHA256 YYYYMMDDTHHMMSSZ');process.exit(2)}
const root=path.resolve(__dirname,'..'), data=path.join(root,'data')
const files=['payments.json','payment-tombstones.json','payment-notifications.json']
const hash=b=>crypto.createHash('sha256').update(b).digest('hex')
const raw=fs.readFileSync(sourcePath), actualHash=hash(raw)
if(actualHash!==expectedHash)throw new Error(`Source SHA-256 mismatch: ${actualHash}`)
const source=JSON.parse(raw); if(!Array.isArray(source.payments))throw new Error('Invalid source payment store')
const users=JSON.parse(fs.readFileSync(path.join(data,'auth-users-store.json'),'utf8')).users
const exactName=name=>{const matches=users.filter(u=>u.name.trim().toLowerCase()===name.toLowerCase());if(matches.length!==1)throw new Error(`Expected exactly one target user named ${name}, got ${matches.length}`);return matches[0]}
const manisha=exactName('Manisha')
const ownerMap={anuj:'u-sales1',ram:'u-sales2',deepak:'u-sales3',karan:'u-sales4',shivani:'u-sales5',manisha:manisha.id}
for(const id of Object.values(ownerMap))if(!users.some(u=>u.id===id))throw new Error(`Mapped target user missing: ${id}`)
fs.mkdirSync(path.resolve(backupRoot),{recursive:true,mode:0o700})
const backupDir=path.resolve(backupRoot,`legacy-payment-migration-${runStamp}`);fs.mkdirSync(backupDir,{recursive:false,mode:0o700})
const manifest={migration:'legacy-dispatch-payments-to-local-target',createdAt:runStamp,source:{commit:sourceCommit,sha256:actualHash,originalPath:sourcePath},backups:{}}
for(const file of files){const b=fs.readFileSync(path.join(data,file));const dest=path.join(backupDir,`target-${file}`);fs.writeFileSync(dest,b,{mode:0o400});manifest.backups[file]={path:dest,sha256:hash(b),bytes:b.length}}
const sourceDest=path.join(backupDir,'source-payments.raw.json');fs.writeFileSync(sourceDest,raw,{mode:0o400});manifest.backups.source={path:sourceDest,sha256:actualHash,bytes:raw.length}
const seenIds=new Set(),seenKeys=new Set(),unresolved=[]
const payments=source.payments.map(p=>{
 if(!p.id||seenIds.has(p.id))throw new Error(`Missing/duplicate ID: ${p.id}`);seenIds.add(p.id)
 if(!p.idempotencyKey||seenKeys.has(p.idempotencyKey))throw new Error(`Missing/duplicate idempotency key: ${p.idempotencyKey}`);seenKeys.add(p.idempotencyKey)
 if(!p.createdAt||!/^\d{4}-\d{2}-\d{2}T/.test(p.createdAt))throw new Error(`Invalid createdAt: ${p.id}`)
 const key=String(p.addedBy||'').trim().toLowerCase(),ownerUserId=ownerMap[key]
 if(p.addedBy&&!ownerUserId)unresolved.push({id:p.id,addedBy:p.addedBy})
 const attachments=[], attachmentKeys=new Set()
 const add=a=>{if(!a)return;const identity=a.key||a.url;if(!identity||attachmentKeys.has(identity))return;attachmentKeys.add(identity);attachments.push({...a})}
 ;(p.attachments||[]).forEach(add)
 if((p.screenshotKey||p.screenshotUrl)&&!attachments.some(a=>(p.screenshotKey&&a.key===p.screenshotKey)||(p.screenshotUrl&&a.url===p.screenshotUrl)))add({key:p.screenshotKey||p.screenshotUrl,url:p.screenshotUrl||'',name:p.screenshotName||path.basename(p.screenshotKey||'proof'),contentType:'application/octet-stream',size:0})
 const auditId='audit-import-'+hash(Buffer.from(`legacy-import:${p.id}:${actualHash}`)).slice(0,32)
 return {...p,paymentDate:p.createdAt.slice(0,10),attachments,...(ownerUserId?{ownerUserId}:{}),audit:[...(Array.isArray(p.audit)?p.audit:[]),{id:auditId,type:'created',actor:'legacy-dispatch-import',at:p.createdAt,to:p.status,reason:`Imported from bsm-dispatch-dashboard ${sourceCommit}`}],sourceProvenance:{system:'bsm-dispatch-dashboard',commit:sourceCommit,sourceSha256:actualHash,sourceRecordId:p.id}}
})
const out=JSON.stringify({payments},null,2)+'\n', tomb=JSON.stringify({tombstones:[]},null,2)+'\n', notes=JSON.stringify({notifications:[]},null,2)+'\n'
function atomic(file,content){const target=path.join(data,file),tmp=`${target}.migration-${process.pid}`;fs.writeFileSync(tmp,content,{mode:0o600});fs.renameSync(tmp,target)}
atomic('payments.json',out);atomic('payment-tombstones.json',tomb);atomic('payment-notifications.json',notes)
manifest.result={count:payments.length,totalPaise:payments.reduce((s,p)=>s+Math.round(Number(p.paymentAmount)*100),0),unresolvedOwners:unresolved,targetHashes:{'payments.json':hash(Buffer.from(out)),'payment-tombstones.json':hash(Buffer.from(tomb)),'payment-notifications.json':hash(Buffer.from(notes))}}
const manifestPath=path.join(backupDir,'manifest.json');fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n',{mode:0o400});fs.chmodSync(backupDir,0o500)
console.log(JSON.stringify({backupDir,manifestPath,...manifest.result},null,2))
