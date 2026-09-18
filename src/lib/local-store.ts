import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const dataDir = path.join(process.cwd(), 'data')
const locks = new Map<string, Promise<void>>()
const remote = () => Boolean(process.env.GITHUB_TOKEN && process.env.APP_LOCAL_ONLY !== 'true')
const config = () => ({ token: process.env.GITHUB_TOKEN || '', owner: process.env.GITHUB_OWNER || 'viraai-ui', repo: process.env.GITHUB_REPO || 'bsm-payments-dashboard' })

async function githubFile<T>(filename:string, fallback:T):Promise<{data:T;sha?:string}> {
  const {token,owner,repo}=config()
  const response=await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/data/${encodeURIComponent(filename)}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},cache:'no-store'})
  if(response.status===404)return{data:fallback}
  const body=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(body.message||`Durable data store read failed (${response.status})`)
  try{return{data:JSON.parse(Buffer.from(body.content||'','base64').toString('utf8')) as T,sha:body.sha}}
  catch(error){throw new Error(`Durable data store ${filename} is unreadable or malformed`,{cause:error})}
}
async function githubPut<T>(filename:string,value:T,sha?:string){
  const {token,owner,repo}=config(),body:Record<string,string>={message:`Update ${filename}`,content:Buffer.from(JSON.stringify(value,null,2)).toString('base64')};if(sha)body.sha=sha
  const response=await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/data/${encodeURIComponent(filename)}`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'})
  if(response.status===409||response.status===422)return false
  if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.message||`Durable data store write failed (${response.status})`)}
  return true
}
export async function readLocalJson<T>(filename: string, fallback: T): Promise<T> {
  if(remote())return (await githubFile(filename,fallback)).data
  try { return JSON.parse(await readFile(path.join(dataDir, filename), 'utf8')) as T }
  catch (error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;throw new Error(`Local data store ${filename} is unreadable or malformed`, { cause: error })}
}
export async function writeLocalJson<T>(filename: string, value: T) {
  if(remote()){for(let attempt=0;attempt<4;attempt++){const current=await githubFile(filename,value);if(await githubPut(filename,value,current.sha))return}throw new Error('Durable data store was busy; please retry')}
  await mkdir(dataDir, { recursive: true });const target = path.join(dataDir, filename),temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });await rename(temporary, target)
}
export async function updateLocalJson<T>(filename: string, fallback: T, update: (current: T) => T | Promise<T>): Promise<T> {
  const previous = locks.get(filename) || Promise.resolve();let release!: () => void;const current = new Promise<void>((resolve) => { release = resolve });locks.set(filename, previous.then(() => current));await previous
  try {
    if(remote()){for(let attempt=0;attempt<5;attempt++){const stored=await githubFile(filename,fallback),next=await update(stored.data);if(await githubPut(filename,next,stored.sha))return next}throw new Error('Durable data store was busy; please retry')}
    const next = await update(await readLocalJson(filename, fallback));await writeLocalJson(filename, next);return next
  } finally {release();if (locks.get(filename) === current) locks.delete(filename)}
}
