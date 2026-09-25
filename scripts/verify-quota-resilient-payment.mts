import assert from 'node:assert/strict'
process.env.VERCEL='1';process.env.GITHUB_OWNER='acme';process.env.GITHUB_TOKEN='secret';process.env.GITHUB_REPO='payments-app';process.env.GITHUB_DATA_REPO='payments-data';process.env.GITHUB_DATA_BRANCH='main';process.env.APP_LOCAL_ONLY='false'

type Entry={bytes:Buffer;sha:string};const files=new Map<string,Entry>(),commits:{paths:string[]}[]=[],rest=[] as string[];let sequence=1,head='head-1'
files.set('data/payments.json',{bytes:Buffer.from('{"payments":[]}'),sha:'blob-payments-0'})
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}})
globalThis.fetch=async(url,init={})=>{
 const href=String(url),method=init.method||'GET'
 if(href!=='https://api.github.com/graphql'){rest.push(`${method} ${href}`);return response({message:'API rate limit already exceeded for user ID 1.'},403)}
 const body=JSON.parse(String(init.body)),variables=body.variables||{}
 if(String(body.query).includes('createCommitOnBranch')){
  const input=variables.input;if(input.expectedHeadOid!==head)return response({errors:[{message:'Expected head oid does not match'}]})
  const paths:string[]=[]
  for(const addition of input.fileChanges.additions||[]){const bytes=Buffer.from(addition.contents,'base64');files.set(addition.path,{bytes,sha:`blob-${++sequence}`});paths.push(addition.path)}
  for(const deletion of input.fileChanges.deletions||[]){files.delete(deletion.path);paths.push(deletion.path)}
  head=`head-${++sequence}`;commits.push({paths});return response({data:{createCommitOnBranch:{commit:{oid:head}}}})
 }
 const expression=variables.expression as string,path=expression?.split(':').slice(1).join(':'),entry=files.get(path)
 if(String(body.query).includes('qualifiedName'))return response({data:{repository:{ref:{target:{oid:head}},object:entry?{oid:entry.sha}:null}}})
 return response({data:{repository:{object:entry?{oid:entry.sha,byteSize:entry.bytes.length,text:entry.bytes.toString('utf8'),isBinary:false}:null}}})
}
const {createLinkedPayment,setPaymentAttachments}=await import('../src/lib/payments.ts')
const {storeProofFiles}=await import('../src/lib/local-payment-proofs.ts')
const key='quota-regression-key-0001',input={customerName:'Quota QA',salesOrderId:'so-quota',salesOrderNumber:'SO-QUOTA',orderTotal:100,paymentAmount:10,paymentMode:'Bank Transfer' as const,createdBy:'sales-qa',ownerUserId:'sales-qa',addedBy:'QA',salespersonName:'QA'}
const first=await createLinkedPayment(input,key),proof=Uint8Array.from([82,73,70,70,4,0,0,0,87,69,66,80,86,80,56,32]),attachments=await storeProofFiles(first.payment.id,[new File([proof],'quota.webp',{type:'image/webp'})])
await setPaymentAttachments(first.payment.id,attachments)
const retry=await createLinkedPayment(input,key)
assert.equal(first.duplicate,false);assert.equal(retry.duplicate,true);assert.equal(retry.payment.id,first.payment.id)
const persisted=JSON.parse(files.get('data/payments.json')!.bytes.toString());assert.equal(persisted.payments.filter((p:any)=>p.idempotencyKey===key).length,1)
assert.equal(attachments[0].contentType,'image/webp');assert(files.has(attachments[0].key));assert(rest.length>0);assert(commits.length>=3)
console.log('PASS REST quota blocked: GraphQL CAS commits persisted one idempotent salesperson payment and WebP proof')
