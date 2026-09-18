import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getGitHubDataObject, githubDataConfig, githubDataConfigured, putGitHubDataObject } from './github-data-store'
import { getR2Object, putR2Object, r2Configured } from './r2'

const dataDir=path.join(process.cwd(),'data'),locks=new Map<string,Promise<void>>()
const objectKey=(filename:string)=>`app-data/payments-dashboard/${filename}`
const localAllowed=()=>process.env.APP_LOCAL_ONLY==='true'||(!process.env.VERCEL&&process.env.NODE_ENV!=='production')
type Stored<T>={data:T;version?:string;exists:boolean}
type CacheEntry={stored:Stored<unknown>;freshUntil:number;staleUntil:number}
const cache=new Map<string,CacheEntry>(),inflight=new Map<string,Promise<Stored<unknown>>>()
const ttl=()=>Math.max(1,Number(process.env.DATA_CACHE_TTL_SECONDS)||60)*1000
const staleTtl=()=>Math.max(60,Number(process.env.DATA_CACHE_STALE_SECONDS)||86400)*1000

function backend(){
  if(process.env.APP_LOCAL_ONLY==='true')return'local' as const
  if(r2Configured())return'r2' as const
  if(githubDataConfigured()){githubDataConfig();return'github' as const}
  if(localAllowed())return'local' as const
  throw new Error('Durable payment storage is not configured. Configure Cloudflare R2 or GITHUB_OWNER, GITHUB_TOKEN, and a dedicated GITHUB_DATA_REPO.')
}
function parse<T>(bytes:Buffer,filename:string){try{return JSON.parse(bytes.toString('utf8')) as T}catch(error){throw new Error(`Durable data store ${filename} is unreadable or malformed`,{cause:error})}}
async function bundledFile<T>(filename:string,fallback:T):Promise<T>{try{return parse<T>(await readFile(path.join(dataDir,filename)),filename)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return fallback;throw error}}
async function githubFile<T>(filename:string,fallback:T):Promise<Stored<T>>{const object=await getGitHubDataObject(`data/${filename}`);if(object)return{data:parse(object.bytes,filename),version:object.sha,exists:true};return{data:await bundledFile(filename,fallback),exists:false}}
async function githubPut<T>(filename:string,value:T,sha?:string){return putGitHubDataObject(`data/${filename}`,Buffer.from(JSON.stringify(value,null,2)),`Update ${filename}`,sha)}
async function r2File<T>(filename:string,fallback:T):Promise<Stored<T>>{const object=await getR2Object(objectKey(filename));if(!object)return{data:await bundledFile(filename,fallback),exists:false};return{data:parse(object.bytes,filename),version:object.etag||undefined,exists:true}}
async function r2Put<T>(filename:string,value:T,etag?:string){return putR2Object(objectKey(filename),'application/json',Buffer.from(JSON.stringify(value,null,2)),etag?{etag}:{createOnly:true})}
async function localRead<T>(filename:string,fallback:T){return bundledFile(filename,fallback)}
async function localWrite<T>(filename:string,value:T){await mkdir(dataDir,{recursive:true});const target=path.join(dataDir,filename),temporary=`${target}.${process.pid}.${crypto.randomUUID()}.tmp`;await writeFile(temporary,JSON.stringify(value,null,2),{mode:0o600});await rename(temporary,target)}
function cacheValue<T>(filename:string,stored:Stored<T>){const now=Date.now();cache.set(filename,{stored:stored as Stored<unknown>,freshUntil:now+ttl(),staleUntil:now+staleTtl()})}
async function cachedRemoteRead<T>(selected:'github'|'r2',filename:string,fallback:T):Promise<Stored<T>>{
  const now=Date.now(),hit=cache.get(filename)
  if(hit&&hit.freshUntil>now)return hit.stored as Stored<T>
  let pending=inflight.get(filename) as Promise<Stored<T>>|undefined
  if(!pending){pending=(selected==='github'?githubFile(filename,fallback):r2File(filename,fallback));inflight.set(filename,pending as Promise<Stored<unknown>>)}
  try{const stored=await pending;cacheValue(filename,stored);return stored}
  catch(error){if(hit&&hit.staleUntil>now){console.warn(`Durable data store ${filename} is stale; serving last known data`,error);return hit.stored as Stored<T>}const baseline=await bundledFile(filename,fallback);console.warn(`Durable data store ${filename} is unavailable; serving bundled baseline`,error);return{data:baseline,exists:false}}
  finally{if(inflight.get(filename)===pending)inflight.delete(filename)}
}
async function authoritativeRemoteRead<T>(selected:'github'|'r2',filename:string,fallback:T){
  try{return await(selected==='github'?githubFile(filename,fallback):r2File(filename,fallback))}
  catch(error){throw new Error('Durable data store is temporarily unavailable; no changes were saved. Please retry shortly.',{cause:error})}
}

/** Shared raw-store read cache only; authorization is always evaluated by callers. */
export async function readLocalJson<T>(filename:string,fallback:T):Promise<T>{const selected=backend();if(selected==='local')return localRead(filename,fallback);return(await cachedRemoteRead(selected,filename,fallback)).data}
export async function writeLocalJson<T>(filename:string,value:T){const selected=backend();if(selected==='local'){await localWrite(filename,value);return}for(let attempt=0;attempt<5;attempt++){const stored=await authoritativeRemoteRead(selected,filename,value);const ok=selected==='r2'?await r2Put(filename,value,stored.version):await githubPut(filename,value,stored.version);if(ok){cacheValue(filename,{data:value,exists:true});return}}throw new Error('Durable data store was busy; no changes were saved. Please retry')}
export async function updateLocalJson<T>(filename:string,fallback:T,update:(current:T)=>T|Promise<T>):Promise<T>{const previous=locks.get(filename)||Promise.resolve();let release!:()=>void;const current=new Promise<void>(resolve=>{release=resolve});locks.set(filename,previous.then(()=>current));await previous;try{const selected=backend();if(selected==='local'){const next=await update(await localRead(filename,fallback));await localWrite(filename,next);return next}for(let attempt=0;attempt<5;attempt++){const stored=await authoritativeRemoteRead(selected,filename,fallback),next=await update(stored.data);const ok=selected==='r2'?await r2Put(filename,next,stored.version):await githubPut(filename,next,stored.version);if(ok){cacheValue(filename,{data:next,exists:true});return next}}throw new Error('Durable data store was busy; no changes were saved. Please retry')}finally{release();if(locks.get(filename)===current)locks.delete(filename)}}

/** Test-only cache reset; intentionally not exposed through an HTTP route. */
export function clearLocalStoreCache(){cache.clear();inflight.clear()}
