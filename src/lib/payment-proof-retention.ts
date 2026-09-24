import { deleteR2Object, getR2Object, headR2Object, putR2Object, r2Configured } from './r2'
import { deleteGitHubDataObject, getGitHubDataObject, putGitHubDataObject } from './github-data-store'
import { readLocalJsonFresh, updateLocalJson } from './local-store'
import { isPaymentProofExpired, proofExpiresAt, type Payment, type PaymentAttachment } from './payments'

type Store={payments:Payment[]}
const EMPTY:Store={payments:[]}, FILE='payments.json'
const safeKey=(key:string)=>/^(?:proofs\/[a-zA-Z0-9-]+\/[a-f0-9-]+\.(?:pdf|jpg|png|gif|webp|heic|heif)|payment-proofs\/[a-zA-Z0-9-]+\/[a-f0-9-]+\.(?:pdf|jpg|png|gif|webp|heic|heif)|payments\/bsm-payments-dashboard\/[^\0-\x1f\\]+)$/.test(key)&&!key.split('/').some(s=>s==='.'||s==='..')

export async function runPaymentProofRetention(options:{dryRun:boolean;limit?:number;now?:number}){
 const now=options.now??Date.now(),limit=Math.min(100,Math.max(1,options.limit||25)),store=await readLocalJsonFresh(FILE,EMPTY)
 const candidates:{paymentId:string;attachment:PaymentAttachment;expiresAt:string}[]=[]
 for(const payment of store.payments)for(const attachment of payment.attachments||[])if(isPaymentProofExpired(payment,attachment,now)&&safeKey(attachment.key))candidates.push({paymentId:payment.id,attachment,expiresAt:new Date(proofExpiresAt(payment,attachment)).toISOString()})
 candidates.sort((a,b)=>a.expiresAt.localeCompare(b.expiresAt));const batch=candidates.slice(0,limit)
 const report={dryRun:options.dryRun,scannedPayments:store.payments.length,expiredMetadata:candidates.length,processed:0,deletedObjects:0,missingObjects:0,deletedBytes:0,failures:[] as {paymentId:string;key:string;error:string}[],objects:batch.map(x=>({paymentId:x.paymentId,key:x.attachment.key,size:x.attachment.size,expiresAt:x.expiresAt})),remaining:Math.max(0,candidates.length-batch.length),oldestRetained:null as string|null,backupKey:null as string|null}
 if(options.dryRun)return report
 const stamp=new Date(now).toISOString().replace(/[:.]/g,'-');report.backupKey=`backups/payment-proof-retention/${stamp}-payments.json`
 if(r2Configured()){const raw=await getR2Object('app-data/payments-dashboard/payments.json');if(raw)await putR2Object(report.backupKey,'application/json',raw.bytes,{createOnly:true})}
 else{const raw=await getGitHubDataObject('data/payments.json');if(raw&&!await putGitHubDataObject(report.backupKey,raw.bytes,'Backup before payment proof retention'))throw new Error('Could not create retention backup')}
 for(const item of batch){try{if(item.attachment.key.startsWith('proofs/')){const found=await getGitHubDataObject(item.attachment.key);if(found){if(!await deleteGitHubDataObject(item.attachment.key))throw new Error('GitHub proof delete failed');report.deletedObjects++;report.deletedBytes+=item.attachment.size}else report.missingObjects++}else{const meta=await headR2Object(item.attachment.key);if(meta.exists){await deleteR2Object(item.attachment.key);report.deletedObjects++;report.deletedBytes+=Math.max(0,meta.contentLength)}else report.missingObjects++}
   await updateLocalJson(FILE,EMPTY,current=>({payments:current.payments.map(payment=>{if(payment.id!==item.paymentId)return payment;const found=(payment.attachments||[]).find(a=>a.key===item.attachment.key);if(!found||!isPaymentProofExpired(payment,found,now))return payment;const at=new Date(now).toISOString();return{...payment,attachments:(payment.attachments||[]).filter(a=>a.key!==item.attachment.key),updatedAt:at,audit:[...(payment.audit||[]),{id:`audit-${crypto.randomUUID()}`,type:'proof_expired' as const,actor:'retention-janitor',at,reason:`Expired payment proof removed (${found.name}; 1 file)`}]}})}));report.processed++
  }catch(error){report.failures.push({paymentId:item.paymentId,key:item.attachment.key,error:error instanceof Error?error.message:'Unknown error'})}}
 return report
}