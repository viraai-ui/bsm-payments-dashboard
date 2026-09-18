import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getGitHubDataObject, githubDataConfig, githubDataConfigured, putGitHubDataObject } from './github-data-store'
import { getR2Object, putR2Object, r2Configured } from './r2'

const dataDir=path.join(process.cwd(),'data'),locks=new Map<string,Promise<void>>()
const objectKey=(filename:string)=>`app-data/payments-dashboard/${filename}`
const localAllowed=()=>process.env.APP_LOCAL_ONLY==='true'||(!process.env.VERCEL&&process.env.NODE_ENV!=='production')
type Stored<T>={data:T;version?:string;exists:boolean}
function backend(){
  if(process.env.APP_LOCAL_ONLY==='true')return'local' as const
  if(r2Configured())return'r2' as const
  if(githubDataConfigured()){githubDataConfig();return'github' as const}
  if(localAllowed())return'local' as const
  throw new Error('Durable payment storage is not configured. Configure Cloudflare R2 or GITHUB_OWNER, GITHUB_TOKEN, and a dedicated GITHUB_DATA_REPO.')
}
function parse<T>(bytes:Buffer,filename:string){try{return JSON.parse(bytes.toString('utf8')) as T}catch(error){throw new Error(`Durable data store ${filename} is unreadable or malformed`,{cause:error})}}
async function legacyFile<T>(filename:string,fallback:T):Promise<T>{
  const token=(process.env.GITHUB_TOKEN||'').trim(),owner=(process.env.GITHUB_OWNER||'').trim(),repo=(process.env.GITHUB_REPO||'').trim()
  if(!token||!owner||!repo)return fallback
  const response=await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/data/${encodeURIComponent(filename)}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},cache:'no-store'})
  if(response.status===404)return fallback
  const body=await response.json().catch(()=>({})) as {message?:string;content?:string}
  if(!response.ok)throw new Error(body.message||`Legacy data store read failed (${response.status})`)
  return parse(Buffer.from((body.content||'').replace(/\n/g,''),'base64'),filename)
}
async function githubFile<T>(filename:string,fallback:T):Promise<Stored<T>>{const object=await getGitHubDataObject(`data/${filename}`);if(object)return{data:parse(object.bytes,filename),version:object.sha,exists:true};return{data:await legacyFile(filename,fallback),exists:false}}
async function githubPut<T>(filename:string,value:T,sha?:string){return putGitHubDataObject(`data/${filename}`,Buffer.from(JSON.stringify(value,null,2)),`Update ${filename}`,sha)}
async function r2File<T>(filename:string,fallback:T):Promise<Stored<T>>{const object=await getR2Object(objectKey(filename));if(!object)return{data:await legacyFile(filename,fallback),exists:false};return{data:parse(object.bytes,filename),version:object.etag||undefined,exists:true}}
async function r2Put<T>(filename:string,value:T,etag?:string){return putR2Object(objectKey(filename),'application/json',Buffer.from(JSON.stringify(value,null,2)),etag?{etag}:{createOnly:true})}
async function localRead<T>(filename:string,fallback:T){try{return JSON.parse(await readFile(path.join(dataDir,filename),'utf8'))as T}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return fallback;throw new Error(`Local data store ${filename} is unreadable or malformed`,{cause:error})}}
async function localWrite<T>(filename:string,value:T){await mkdir(dataDir,{recursive:true});const target=path.join(dataDir,filename),temporary=`${target}.${process.pid}.${crypto.randomUUID()}.tmp`;await writeFile(temporary,JSON.stringify(value,null,2),{mode:0o600});await rename(temporary,target)}

export async function readLocalJson<T>(filename:string,fallback:T):Promise<T>{const selected=backend();if(selected==='r2')return(await r2File(filename,fallback)).data;if(selected==='github')return(await githubFile(filename,fallback)).data;return localRead(filename,fallback)}
export async function writeLocalJson<T>(filename:string,value:T){const selected=backend();if(selected==='local')return localWrite(filename,value);for(let attempt=0;attempt<5;attempt++){const stored=selected==='r2'?await r2File(filename,value):await githubFile(filename,value);const ok=selected==='r2'?await r2Put(filename,value,stored.version):await githubPut(filename,value,stored.version);if(ok)return}throw new Error('Durable data store was busy; please retry')}
export async function updateLocalJson<T>(filename:string,fallback:T,update:(current:T)=>T|Promise<T>):Promise<T>{const previous=locks.get(filename)||Promise.resolve();let release!:()=>void;const current=new Promise<void>(resolve=>{release=resolve});locks.set(filename,previous.then(()=>current));await previous;try{const selected=backend();if(selected==='local'){const next=await update(await localRead(filename,fallback));await localWrite(filename,next);return next}for(let attempt=0;attempt<5;attempt++){const stored=selected==='r2'?await r2File(filename,fallback):await githubFile(filename,fallback),next=await update(stored.data);const ok=selected==='r2'?await r2Put(filename,next,stored.version):await githubPut(filename,next,stored.version);if(ok)return next}throw new Error('Durable data store was busy; please retry')}finally{release();if(locks.get(filename)===current)locks.delete(filename)}}
