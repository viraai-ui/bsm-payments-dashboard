import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {readAuthoritativeJson,updateLocalJson} from '../src/lib/local-store'
import {fetchCrmQuoteOwner,resolveCrmOwnership} from '../src/lib/crm-order-owner'
import {salespersonOwnsOrder,selectSalespersonOverview} from '../src/lib/salesperson-overview'
import {fetchZohoPaymentOrderDetail} from '../src/lib/zoho-payment-orders'
import assert from 'node:assert/strict'
const file='payment-order-index.json',id='1154219000038460004',quoteId='442181000045625050'
const before=await readAuthoritativeJson<any>(file,{orders:{}}),users=(await readAuthoritativeJson<any>('auth-users-store.json',{users:[]})).users
assert(before.orders[id]);assert.equal(before.orders[id].salesOrderNumber,'SO-08189')
const detail=await fetchZohoPaymentOrderDetail(id);assert.equal(detail.crmQuoteId,quoteId);assert.equal(detail.orderTotal,81420)
await mkdir('backups',{recursive:true});const backup=`backups/crm-owner-before-${Date.now()}.json`;await writeFile(backup,JSON.stringify(before,null,2),{mode:0o600})
const quote=await fetchCrmQuoteOwner(quoteId),patch=resolveCrmOwnership({...before.orders[id],crmQuoteId:quoteId},quote,users)
assert(patch.crmOwner);assert(!patch.crmOwnerConflict)
await updateLocalJson<any>(file,{orders:{}},s=>{const o=s.orders[id];assert(o);assert.equal(o.salesOrderNumber,'SO-08189');if(o.crmQuoteId)assert.equal(o.crmQuoteId,quoteId);Object.assign(o,resolveCrmOwnership({...o,crmQuoteId:quoteId},quote,users),{crmQuoteId:quoteId});return s})
const after=await readAuthoritativeJson<any>(file,{orders:{}}),order=after.orders[id],owner=users.find((u:any)=>u.id===order.crmOwner.dashboardUserId)
assert.equal(Object.keys(before.orders).length,Object.keys(after.orders).length)
for(const [key,value] of Object.entries(before.orders)){if(key!==id)assert.deepEqual(after.orders[key],value)}
const stripped={...order},original={...before.orders[id]};for(const k of ['crmQuoteId','crmOwner','crmOwnerConflict']){delete stripped[k];delete original[k]}assert.deepEqual(stripped,original)
assert(salespersonOwnsOrder(order,owner));for(const user of users.filter((u:any)=>u.active&&['Salesperson','Spare Part Sales'].includes(u.role)&&u.id!==owner.id))assert(!salespersonOwnsOrder(order,user))
assert.equal(selectSalespersonOverview([order],[],owner,{lastSyncedAt:'',recencyVerifiedAt:''}).orders.length,1)
console.log(JSON.stringify({backup,count:Object.keys(after.orders).length,order,owner:{id:owner.id,email:owner.email,role:owner.role},otherUsersDenied:true,source:'authoritative-production-projection'}))
