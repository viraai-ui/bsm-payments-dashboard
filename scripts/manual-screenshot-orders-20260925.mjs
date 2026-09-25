#!/usr/bin/env node
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises'
import path from 'node:path'

const root=process.env.DATA_REPO_PATH
assert(root,'DATA_REPO_PATH must point to a clean checkout of the production data repository')
const apply=process.argv.includes('--apply'),file=path.join(root,'data/payment-order-index.json')
const expected=[
 ['SO-08039','2026-09-25','DERPA INDUSTRIAL POLYMERS P.LTD.','draft',0],
 ['SO-08038','2026-09-25','Samu Sports','confirmed',51700],
 ['SO-08037','2026-09-25','Asian Footwear Pvt.Ltd. ( 280)','confirmed',36580],
 ['SO-08036','2026-09-25','VISHAL','closed',34999],
 ['SO-08034','2026-09-25','Asian Footwear Pvt.Ltd. ( 280)','confirmed',531000],
 ['SO-08033','2026-09-24','Mata Bala Sundari Enterprises','closed',108929],
 ['SO-08032','2026-09-24','AMBEY ENTERPRISES','closed',57230],
 ['SO-08031','2026-09-24','Mehak International','confirmed',74160],
 ['SO-08030','2026-09-24',"Lord's Mark Industries Limited",'confirmed',73726],
 ['SO-08029','2026-09-24','MANSA UPPER','closed',41300],
 ['SO-08028','2026-09-24','LEPERA INDUSTRIES PRIVATE LIMITED','confirmed',5192],
 ['SO-08027','2026-09-24','Sai Products And Grafiq Pvt. Ltd','confirmed',578200],
]
const canonical=v=>String(v).replace(/[^a-z0-9]/gi,'').toUpperCase(),sha=b=>crypto.createHash('sha256').update(b).digest('hex')
const before=await readFile(file),store=JSON.parse(before),at=new Date().toISOString(),added=[],preserved=[]
for(const [number,orderDate,customerName,status,orderTotal] of expected){
 const matches=Object.values(store.orders||{}).filter(o=>canonical(o.salesOrderNumber)===canonical(number))
 assert(matches.length<=1,`Duplicate production records for ${number}`)
 if(matches.length){preserved.push({number,id:matches[0].id,record:matches[0]});continue}
 const id=`manual-screenshot-20260925-${number.toLowerCase()}`
 store.orders[id]={id,salesOrderNumber:number,customerName,status,orderDate,orderTotal,currency:'INR',modifiedTime:at,manualSource:{kind:'authorized-screenshot-index-only',sourceDate:'2026-09-25',enteredAt:at,reconcileBy:'canonical-sales-order-number'}}
 added.push(number)
}
store.updatedAt=at
for(const [number] of expected)assert.equal(Object.values(store.orders).filter(o=>canonical(o.salesOrderNumber)===canonical(number)).length,1)
const after=Buffer.from(`${JSON.stringify(store,null,2)}\n`),stamp=at.replace(/[:.]/g,'-'),backup=path.join(root,'backups/manual-screenshot-orders-20260925',`${stamp}-payment-order-index-${sha(before).slice(0,12)}.json`)
const report={mode:apply?'apply':'dry-run',added,preserved:preserved.map(x=>({number:x.number,id:x.id,status:x.record.status,modifiedTime:x.record.modifiedTime})),backup:path.relative(root,backup),beforeSha256:sha(before),afterSha256:sha(after),count:Object.keys(store.orders).length}
if(apply){await mkdir(path.dirname(backup),{recursive:true});await copyFile(file,backup);assert.equal(sha(await readFile(backup)),sha(before));await writeFile(file,after);assert.equal(sha(await readFile(file)),sha(after))}
console.log(JSON.stringify(report,null,2))