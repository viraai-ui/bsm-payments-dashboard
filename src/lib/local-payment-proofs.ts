import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { PaymentAttachment } from './payments'
import { deleteGitHubDataObject, getGitHubDataObject, githubDataConfig, githubDataConfigured, putGitHubDataObject } from './github-data-store'
import { deleteR2Object, getR2Object, r2Configured, uploadBufferToR2 } from './r2'

export const MAX_PAYMENT_PROOFS=5
export const MAX_PAYMENT_PROOF_BYTES=10*1024*1024
export const GITHUB_MAX_PAYMENT_PROOF_BYTES=5*1024*1024
const ROOT=path.resolve(process.cwd(),'data','uploads','payment-proofs')
const MIME_EXT:Record<string,string>={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp','image/heic':'heic','image/heif':'heif'}
const localAllowed=()=>process.env.APP_LOCAL_ONLY==='true'||(!process.env.VERCEL&&process.env.NODE_ENV!=='production')
function storage(){if(process.env.APP_LOCAL_ONLY==='true')return'local' as const;if(r2Configured())return'r2' as const;if(githubDataConfigured()){githubDataConfig();return'github' as const}if(localAllowed())return'local' as const;throw new Error('Payment proof storage is not configured. Configure Cloudflare R2 or a dedicated GITHUB_DATA_REPO.')}
function detectedMime(bytes:Uint8Array){if(bytes.length>=5&&new TextDecoder().decode(bytes.slice(0,5))==='%PDF-')return'application/pdf';if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return'image/jpeg';if(bytes.length>=8&&bytes.slice(0,8).every((v,i)=>v===[137,80,78,71,13,10,26,10][i]))return'image/png';if(bytes.length>=6&&['GIF87a','GIF89a'].includes(new TextDecoder().decode(bytes.slice(0,6))))return'image/gif';if(bytes.length>=12&&new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP')return'image/webp';if(bytes.length>=12&&new TextDecoder().decode(bytes.slice(4,8))==='ftyp')return'image/heic';return''}
export function validateProofFiles(files:File[]){if(files.length>MAX_PAYMENT_PROOFS)throw new Error('Attach up to 5 images or PDFs.');const limit=storage()==='github'?GITHUB_MAX_PAYMENT_PROOF_BYTES:MAX_PAYMENT_PROOF_BYTES;for(const file of files){if(!file.size||file.size>limit)throw new Error(`Each proof must be non-empty and no larger than ${limit/(1024*1024)} MB${limit===GITHUB_MAX_PAYMENT_PROOF_BYTES?' while GitHub proof storage is active':''}.`);if(!MIME_EXT[file.type])throw new Error('Proofs must be images or PDFs.')}}
export async function storeProofFiles(paymentId:string,files:File[]):Promise<PaymentAttachment[]>{
 validateProofFiles(files);if(!/^[a-zA-Z0-9-]+$/.test(paymentId))throw new Error('Invalid payment ID');const selected=storage(),directory=path.join(ROOT,paymentId);if(selected==='local')await mkdir(directory,{recursive:true,mode:0o700});const saved:PaymentAttachment[]=[]
 try{for(const file of files){const bytes=new Uint8Array(await file.arrayBuffer()),actual=detectedMime(bytes);if(!actual||(actual!==file.type&&!(actual==='image/heic'&&file.type==='image/heif')))throw new Error('A proof file does not match its declared image/PDF type.');const relative=`${paymentId}/${crypto.randomUUID()}.${MIME_EXT[file.type]}`,key=selected==='github'?`proofs/${relative}`:selected==='r2'?`payment-proofs/${relative}`:relative;if(selected==='r2')await uploadBufferToR2(key,file.type,Buffer.from(bytes));else if(selected==='github'){if(!await putGitHubDataObject(key,Buffer.from(bytes),`Store proof for ${paymentId}`))throw new Error('Proof object already exists')}else await writeFile(path.join(ROOT,key),bytes,{mode:0o600,flag:'wx'});saved.push({key,url:`/api/payments/${encodeURIComponent(paymentId)}/proof?index=${saved.length}`,name:path.basename(file.name).slice(0,180)||'Payment proof',contentType:file.type,size:file.size})}return saved
 }catch(cause){await deleteProofAttachments(saved);if(selected==='local')await rm(directory,{recursive:true,force:true});throw cause}
}
export async function readProof(key:string){
 if(key.startsWith('proofs/')){if(!/^proofs\/[a-zA-Z0-9-]+\/[a-f0-9-]+\.(?:pdf|jpg|png|gif|webp|heic|heif)$/.test(key)||!githubDataConfigured())return null;return(await getGitHubDataObject(key))?.bytes||null}
 if(key.startsWith('payment-proofs/')||key.startsWith('payments/')){if(!r2Configured())return null;return(await getR2Object(key))?.bytes||null}
 if(!/^[a-zA-Z0-9-]+\/[a-f0-9-]+\.(?:pdf|jpg|png|gif|webp|heic|heif)$/.test(key)||!localAllowed())return null;const target=path.resolve(ROOT,key);if(!target.startsWith(`${ROOT}${path.sep}`))return null;try{return await readFile(target)}catch{return null}
}
export async function deletePaymentProofs(paymentId:string){if(storage()==='local'&&/^[a-zA-Z0-9-]+$/.test(paymentId))await rm(path.join(ROOT,paymentId),{recursive:true,force:true})}
export async function deleteProofAttachments(attachments:PaymentAttachment[]){await Promise.all(attachments.map(async a=>{if(a.key.startsWith('proofs/'))return deleteGitHubDataObject(a.key).catch(()=>false);if(a.key.startsWith('payment-proofs/')||a.key.startsWith('payments/'))return deleteR2Object(a.key).catch(()=>false);if(!/^[a-zA-Z0-9-]+\/[a-f0-9-]+\.(?:pdf|jpg|png|gif|webp|heic|heif)$/.test(a.key))return;const target=path.resolve(ROOT,a.key);if(target.startsWith(`${ROOT}${path.sep}`))await unlink(target).catch(()=>{})}))}
