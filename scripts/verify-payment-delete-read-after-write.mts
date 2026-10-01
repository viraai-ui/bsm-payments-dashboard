import assert from 'node:assert/strict'

Object.assign(process.env, {
  APP_LOCAL_ONLY: 'false', VERCEL: '1', NODE_ENV: 'production',
  R2_ACCOUNT_ID: 'test-account', R2_ACCESS_KEY_ID: 'test-key',
  R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET: 'test-bucket',
  R2_ENDPOINT: 'https://test.r2.invalid',
})

const sonia = { id:'u-sonia', name:'Sonia', email:'sonia@bsmindia.com', username:'sonia', role:'Spare Part Sales', active:true, createdAt:'', updatedAt:'' } as any
const payment = { id:'payment-00000000-0000-4000-8000-000000000001', customerName:'Manual customer', manualReference:'DELETE-ME', paymentAmount:100, paymentMode:'Cash', paymentDate:'2026-10-01', status:'Pending', createdBy:sonia.id, ownerUserId:sonia.id, createdAt:'2026-10-01T00:00:00.000Z', updatedAt:'2026-10-01T00:00:00.000Z' }
const objects = new Map<string,{body:unknown;etag:string}>([
  ['payments.json',{body:{payments:[payment]},etag:'payments-1'}],
  ['payment-tombstones.json',{body:{tombstones:[]},etag:'tombstones-1'}],
  ['auth-users-store.json',{body:{users:[{...sonia,passwordHash:'unused'}],permissions:{}},etag:'users-1'}],
  ['sales-order-snapshots.json',{body:{orders:{}},etag:'snapshots-1'}],
])
let reads = 0
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input)), name = decodeURIComponent(url.pathname).split('/').pop()!, method = init.method || 'GET', stored = objects.get(name)
  if (method === 'PUT') {
    if (!stored || (init.headers as Record<string,string>)?.['if-match'] !== stored.etag) return new Response('', { status: 412 })
    const next = { body:JSON.parse(Buffer.from(init.body as Uint8Array).toString()), etag:`${name}-${Date.now()}-${Math.random()}` }
    objects.set(name,next); return new Response('',{status:200,headers:{etag:next.etag}})
  }
  reads++
  return stored ? new Response(JSON.stringify(stored.body),{status:200,headers:{etag:stored.etag}}) : new Response('',{status:404})
}

const { readLocalJson } = await import('../src/lib/local-store.ts')
const { deletePaymentWithTombstone, paymentReadModelForUserFresh } = await import('../src/lib/payments.ts')
await readLocalJson('payments.json',{payments:[]}) // pre-delete cache on this instance
await deletePaymentWithTombstone(payment.id,sonia,'entered in error')
assert.equal((objects.get('payments.json')!.body as any).payments.some((item:any)=>item.id===payment.id),false,'delete is durable before success returns')
const readsBeforePolls=reads
for(let poll=0;poll<3;poll++)assert.equal((await paymentReadModelForUserFresh(sonia)).payments.some(item=>item.id===payment.id),false,`fresh poll ${poll+1} cannot resurrect the deleted payment`)
assert.ok(reads>=readsBeforePolls+3,'each production-shaped payment poll performs an authoritative durable read')
const tombstones=(objects.get('payment-tombstones.json')!.body as any).tombstones
assert.equal(tombstones[0].payment.id,payment.id,'audit tombstone remains durable')
console.log('PASS durable delete remains absent across repeated production-shaped fresh polls')