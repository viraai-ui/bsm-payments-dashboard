const API = 'https://api.github.com'
const TIMEOUT_MS = 15_000

export type GitHubObject = { bytes: Buffer; sha: string; contentType?: string }

function env(name: string) { return (process.env[name] || '').trim() }
export function githubDataConfigured() { return Boolean(env('GITHUB_TOKEN') && env('GITHUB_OWNER') && env('GITHUB_DATA_REPO')) && process.env.APP_LOCAL_ONLY !== 'true' }
export function githubDataConfig() {
  const token=env('GITHUB_TOKEN'),owner=env('GITHUB_OWNER'),repo=env('GITHUB_DATA_REPO'),branch=env('GITHUB_DATA_BRANCH')
  if(!token||!owner||!repo)throw new Error('GitHub data storage is not configured (GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_DATA_REPO are required)')
  if(repo===env('GITHUB_REPO'))throw new Error('GITHUB_DATA_REPO must be a dedicated repository, not the application repository')
  return {token,owner,repo,branch}
}
function safePath(value:string){
  if(!value||value.startsWith('/')||value.includes('\\')||value.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('Invalid GitHub data object path')
  return value.split('/').map(encodeURIComponent).join('/')
}
function headers(token:string){return {Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}}
async function result(response:Response,operation:string){const body=await response.json().catch(()=>({})) as {message?:string};if(!response.ok)throw new Error(body.message||`GitHub data store ${operation} failed (${response.status})`);return body as Record<string,unknown>}

async function getGitHubDataObjectViaGraphql(objectPath:string):Promise<GitHubObject|null>{
  const {token,owner,repo,branch}=githubDataConfig(),expression=`${branch||'HEAD'}:${objectPath}`
  const response=await fetch(`${API}/graphql`,{method:'POST',headers:{...headers(token),'Content-Type':'application/json'},body:JSON.stringify({query:'query($owner:String!,$repo:String!,$expression:String!){repository(owner:$owner,name:$repo){object(expression:$expression){... on Blob{oid byteSize text isBinary}}}}',variables:{owner,repo,expression}}),cache:'no-store',signal:AbortSignal.timeout(TIMEOUT_MS)})
  const body=await response.json().catch(()=>({})) as {data?:{repository?:{object?:{oid?:string;text?:string|null;isBinary?:boolean}}};errors?:Array<{message?:string}>}
  if(!response.ok||body.errors?.length)throw new Error(body.errors?.[0]?.message||`GitHub data store GraphQL read failed (${response.status})`)
  const object=body.data?.repository?.object;if(!object)return null
  if(!object.oid||object.isBinary||typeof object.text!=='string')throw new Error('GitHub data store GraphQL returned an unreadable object')
  return{bytes:Buffer.from(object.text,'utf8'),sha:object.oid}
}

async function repositoryHeadAndObject(objectPath:string){
  const {token,owner,repo,branch}=githubDataConfig(),qualifiedName=`refs/heads/${branch||'main'}`,expression=`${branch||'HEAD'}:${objectPath}`
  const response=await fetch(`${API}/graphql`,{method:'POST',headers:{...headers(token),'Content-Type':'application/json'},body:JSON.stringify({query:'query($owner:String!,$repo:String!,$qualifiedName:String!,$expression:String!){repository(owner:$owner,name:$repo){ref(qualifiedName:$qualifiedName){target{oid}} object(expression:$expression){... on Blob{oid}}}}',variables:{owner,repo,qualifiedName,expression}}),cache:'no-store',signal:AbortSignal.timeout(TIMEOUT_MS)})
  const body=await response.json().catch(()=>({})) as {data?:{repository?:{ref?:{target?:{oid?:string}};object?:{oid?:string}}};errors?:Array<{message?:string}>}
  if(!response.ok||body.errors?.length)throw new Error(body.errors?.[0]?.message||`GitHub data store GraphQL head read failed (${response.status})`)
  const headOid=body.data?.repository?.ref?.target?.oid
  if(!headOid)throw new Error('GitHub data store branch was not found')
  return{headOid,objectOid:body.data?.repository?.object?.oid}
}

/** GraphQL commit mutations use a quota independent of the REST Contents API.
 * expectedHeadOid plus the object OID check preserves compare-and-swap. */
async function mutateGitHubDataObjectViaGraphql(objectPath:string,message:string,bytes?:Buffer,expectedObjectOid?:string){
  const {token,owner,repo,branch}=githubDataConfig(),path=decodeURIComponent(safePath(objectPath)),head=await repositoryHeadAndObject(objectPath)
  if(expectedObjectOid!==undefined&&head.objectOid!==expectedObjectOid)return false
  if(bytes===undefined&&!head.objectOid)return false
  const additions=bytes===undefined?[]:[{path,contents:bytes.toString('base64')}],deletions=bytes===undefined?[{path}]:[]
  const response=await fetch(`${API}/graphql`,{method:'POST',headers:{...headers(token),'Content-Type':'application/json'},body:JSON.stringify({query:'mutation($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid}}}',variables:{input:{branch:{repositoryNameWithOwner:`${owner}/${repo}`,branchName:branch||'main'},message:{headline:message},expectedHeadOid:head.headOid,fileChanges:{additions,deletions}}}}),cache:'no-store',signal:AbortSignal.timeout(TIMEOUT_MS)})
  const body=await response.json().catch(()=>({})) as {data?:{createCommitOnBranch?:{commit?:{oid?:string}}};errors?:Array<{message?:string}>}
  if(body.errors?.some(error=>/expected head oid|branch was modified|not a fast forward/i.test(error.message||'')))return false
  if(!response.ok||body.errors?.length||!body.data?.createCommitOnBranch?.commit?.oid)throw new Error(body.errors?.[0]?.message||`GitHub data store GraphQL write failed (${response.status})`)
  return true
}

/** Reads only from the dedicated private data repository. */
export async function getGitHubDataObject(objectPath:string):Promise<GitHubObject|null>{
  const {token,owner,repo,branch}=githubDataConfig(),query=branch?`?ref=${encodeURIComponent(branch)}`:''
  const response=await fetch(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${safePath(objectPath)}${query}`,{headers:headers(token),cache:'no-store',signal:AbortSignal.timeout(TIMEOUT_MS)})
  if(response.status===404)return null
  if(response.status===403){const body=await response.clone().json().catch(()=>({})) as {message?:string};if(/rate limit/i.test(body.message||''))return getGitHubDataObjectViaGraphql(objectPath)}
  const body=await result(response,'read') as {type?:string;content?:string;encoding?:string;sha?:string}
  if(body.type!=='file'||!body.sha)throw new Error('GitHub data store returned an invalid object')
  if(body.encoding==='base64'&&body.content)return{bytes:Buffer.from(body.content.replace(/\n/g,''),'base64'),sha:body.sha}
  // Contents responses omit inline content for files around/over 1 MB. Blob API remains private and authenticated.
  const blobResponse=await fetch(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(body.sha)}`,{headers:headers(token),cache:'no-store',signal:AbortSignal.timeout(TIMEOUT_MS)})
  const blob=await result(blobResponse,'blob read') as {content?:string;encoding?:string}
  if(blob.encoding!=='base64'||typeof blob.content!=='string')throw new Error('GitHub data store returned an unreadable object')
  return{bytes:Buffer.from(blob.content.replace(/\n/g,''),'base64'),sha:body.sha}
}

export async function putGitHubDataObject(objectPath:string,bytes:Buffer,message:string,sha?:string){
  const {token,owner,repo,branch}=githubDataConfig(),body:Record<string,string>={message,content:bytes.toString('base64')};if(sha)body.sha=sha;if(branch)body.branch=branch
  const response=await fetch(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${safePath(objectPath)}`,{method:'PUT',headers:{...headers(token),'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(TIMEOUT_MS)})
  if(response.status===403){const error=await response.clone().json().catch(()=>({})) as {message?:string};if(/rate limit/i.test(error.message||''))return mutateGitHubDataObjectViaGraphql(objectPath,message,bytes,sha)}
  if(response.status===409||response.status===422)return false
  await result(response,'write');return true
}
export async function deleteGitHubDataObject(objectPath:string,sha?:string){
  let existing:{sha:string}|null
  try{existing=sha?{sha}:await getGitHubDataObject(objectPath)}catch(error){
    // GraphQL cannot return binary blob bytes, but its commit mutation can still
    // remove the exact path with branch-head CAS when REST reads are exhausted.
    console.warn(`GitHub REST object read unavailable while deleting ${objectPath}; using GraphQL CAS`,error)
    return mutateGitHubDataObjectViaGraphql(objectPath,`Delete ${objectPath}`)
  }
  if(!existing)return false
  const {token,owner,repo,branch}=githubDataConfig(),body:Record<string,string>={message:`Delete ${objectPath}`,sha:existing.sha};if(branch)body.branch=branch
  const response=await fetch(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${safePath(objectPath)}`,{method:'DELETE',headers:{...headers(token),'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(TIMEOUT_MS)})
  if(response.status===403){const error=await response.clone().json().catch(()=>({})) as {message?:string};if(/rate limit/i.test(error.message||''))return mutateGitHubDataObjectViaGraphql(objectPath,`Delete ${objectPath}`,undefined,existing.sha)}
  if(response.status===404)return false
  if(response.status===409||response.status===422)return false
  await result(response,'delete');return true
}
