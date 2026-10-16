import { readAuthoritativeJson, updateLocalJson } from './local-store'
import type { StoredPaymentOrder } from './payment-order-search'

export type CrmOwnership={crmQuoteId?:string;crmOwner?:{id:string;email:string;dashboardUserId:string;verifiedAt:string};crmOwnerConflict?:boolean}
const email=(v:string)=>v.trim().toLowerCase()
export function resolveCrmOwnership(order:StoredPaymentOrder,quote:any,users:any[]):CrmOwnership {
 if(!order.crmQuoteId||String(quote.id)!==order.crmQuoteId)throw new Error('CRM quote identity mismatch')
 const owner=quote.Owner, matches=users.filter(u=>u.active&&['Salesperson','Spare Part Sales'].includes(u.role)&&email(u.email||'')===email(owner?.email||''))
 if(!owner?.id||!owner?.email||matches.length!==1)throw new Error('CRM owner has no unique active sales account')
 const next={id:String(owner.id),email:email(owner.email),dashboardUserId:matches[0].id,verifiedAt:new Date().toISOString()}
 // Existing native identities are never overwritten or superseded. Reassignment
 // is an explicit reviewed operation, not an automatic scope expansion.
 if(order.salespersonId||order.salespersonName||order.salespersonEmail)return {crmOwnerConflict:true}
 if(order.crmOwner&&(order.crmOwner.id!==next.id||order.crmOwner.dashboardUserId!==next.dashboardUserId||order.crmOwner.email!==next.email))return {crmOwnerConflict:true}
 return {crmOwner:next,crmOwnerConflict:false}
}
let token:{value:string;until:number}|undefined
export const crmOwnerConfigured=()=>Boolean(process.env.ZOHO_CRM_CLIENT_ID&&process.env.ZOHO_CRM_CLIENT_SECRET&&process.env.ZOHO_CRM_REFRESH_TOKEN)
export async function fetchCrmQuoteOwner(id:string){
 if(!/^\d+$/.test(id)||!crmOwnerConfigured())throw new Error('Separate CRM service credentials are required')
 if(!token||token.until<Date.now()){
  const r=await fetch(`${process.env.ZOHO_CRM_ACCOUNTS_URL||'https://accounts.zoho.in'}/oauth/v2/token`,{method:'POST',body:new URLSearchParams({client_id:process.env.ZOHO_CRM_CLIENT_ID!,client_secret:process.env.ZOHO_CRM_CLIENT_SECRET!,refresh_token:process.env.ZOHO_CRM_REFRESH_TOKEN!,grant_type:'refresh_token'}),signal:AbortSignal.timeout(10000),cache:'no-store'}),j=await r.json()
  if(!r.ok||!j.access_token)throw new Error('CRM service authentication failed')
  token={value:j.access_token,until:Date.now()+Math.max(60,Number(j.expires_in||3600)-120)*1000}
 }
 const r=await fetch(`${process.env.ZOHO_CRM_API_DOMAIN||'https://www.zohoapis.in'}/crm/v8/Quotes/${id}?fields=Owner`,{headers:{Authorization:`Zoho-oauthtoken ${token.value}`},signal:AbortSignal.timeout(10000),cache:'no-store'}),j=await r.json()
 if(!r.ok||!j.data?.[0])throw new Error(`CRM quote owner read failed (${r.status})`)
 return j.data[0]
}
/** Server scheduler lane: bounded, durable daily reservation and per-record retry cache.
 * Reads only current page CRM references, never walks historical orders. */
export async function enrichCrmOrderOwners(ids:string[],maxCalls=10){
 if(!crmOwnerConfigured())return {calls:0,reason:'crm-not-configured'}
 const file='payment-order-index.json',s=await readAuthoritativeJson<any>(file,{orders:{}}),users=(await readAuthoritativeJson<any>('auth-users-store.json',{users:[]})).users
 let calls=0
 for(const id of ids.slice(0,200)){
  const o=s.orders[id] as StoredPaymentOrder
  if(!o?.crmQuoteId||o.crmOwner||o.crmOwnerConflict||o.salespersonId||o.salespersonName||o.salespersonEmail)continue
  let reserved=false;const now=Date.now(),day=new Date().toISOString().slice(0,10)
  await updateLocalJson<any>('crm-owner-budget.json',{day,count:0,retry:{}},b=>{if(b.day!==day)b={day,count:0,retry:{}};if(b.count>=200||Number(b.retry[id]||0)>now)return b;b.count++;b.retry[id]=now+3600000;reserved=true;return b})
  if(!reserved)continue
  calls++
  try{const quote=await fetchCrmQuoteOwner(o.crmQuoteId);await updateLocalJson<any>(file,{orders:{}},current=>{const live=current.orders[id];if(!live||live.crmQuoteId!==o.crmQuoteId)return current;Object.assign(live,resolveCrmOwnership(live,quote,users));return current})}catch{ /* Fail closed: no creator/admin ownership fallback. */ }
  if(calls>=maxCalls)break
 }
 return {calls}
}
