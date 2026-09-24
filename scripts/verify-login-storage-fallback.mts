import assert from 'node:assert/strict'
process.env.GITHUB_OWNER='acme';process.env.GITHUB_TOKEN='secret';process.env.GITHUB_REPO='payments-app';process.env.GITHUB_DATA_REPO='payments-data';process.env.GITHUB_DATA_BRANCH='main';process.env.APP_LOCAL_ONLY='false'
const expected=JSON.stringify({users:[{id:'u-safe'}]})
let rest=0,graphql=0
globalThis.fetch=async(url,init={})=>{
  if(String(url).endsWith('/graphql')){graphql++;const body=JSON.parse(String(init.body));assert.equal(body.variables.expression,'main:data/auth-users-store.json');return Response.json({data:{repository:{object:{oid:'abc123',byteSize:expected.length,text:expected,isBinary:false}}}})}
  rest++;return Response.json({message:'API rate limit exceeded for user ID 1'},{status:403})
}
const {getGitHubDataObject}=await import('../src/lib/github-data-store.ts')
const object=await getGitHubDataObject('data/auth-users-store.json')
assert.equal(rest,1);assert.equal(graphql,1);assert.equal(object?.bytes.toString(),expected);assert.equal(object?.sha,'abc123')
console.log('PASS login storage fallback: REST rate exhaustion uses authoritative private GraphQL blob read')
