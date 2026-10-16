import assert from 'node:assert/strict'
import {resolveCrmOwnership,fetchCrmQuoteOwner} from '../src/lib/crm-order-owner'
import {salespersonOwnsOrder} from '../src/lib/salesperson-overview'
const user:any={id:'sales',email:'exact@example.com',role:'Salesperson',active:true,name:'Owner'},other:any={...user,id:'other',email:'other@example.com'},base:any={id:'order',crmQuoteId:'123'},q={id:'123',Owner:{id:'456',email:user.email}}
const patch=resolveCrmOwnership(base,q,[user,other]);assert.equal(patch.crmOwner?.dashboardUserId,user.id)
assert(salespersonOwnsOrder({...base,...patch},user));assert(!salespersonOwnsOrder({...base,...patch},other))
assert.throws(()=>resolveCrmOwnership(base,q,[user,{...user,id:'duplicate'}]))
assert.throws(()=>resolveCrmOwnership(base,{...q,id:'999'},[user]))
assert.throws(()=>resolveCrmOwnership(base,q,[{...user,role:'Admin'}]))
assert(resolveCrmOwnership({...base,salespersonId:'native'},q,[user]).crmOwnerConflict)
assert(resolveCrmOwnership({...base,...patch},{...q,Owner:{id:'changed',email:user.email}},[user]).crmOwnerConflict)
assert(!salespersonOwnsOrder({...base,...patch,crmOwnerConflict:true},user))
delete process.env.ZOHO_CRM_CLIENT_ID;await assert.rejects(fetchCrmQuoteOwner('123'),/Separate CRM/)
console.log('PASS exact unique sales account, unrelated users denied, native conflict, controlled changed owner, wrong quote, duplicate, admin, missing credential fail closed')
