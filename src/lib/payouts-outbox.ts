import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { readLocalJsonFresh, updateLocalJson } from './local-store'
import { validatePaymentOrder } from './payment-order-search'
import { toPaise } from './payment-settlement'
import type { Payment } from './payments'

export type PaymentEventType = 'received' | 'updated' | 'voided' | 'reversed'
type WireEventType = `payment.${PaymentEventType}`
export type DeliveryOutcome = 'matched' | 'unmatched' | 'company_mismatch' | 'duplicate' | 'manual_review'
export type OutboxStatus = 'pending' | 'delivering' | 'delivered' | 'retrying' | 'failed'
export type PaymentEvent = { type:WireEventType; payment:{ id:string; salesOrderNumber:string; companyName:string; amount?:string; currency:'INR'; receivedAt:string } }
export type OutboxItem = { eventId:string; event:PaymentEvent; body:string; paymentVersion:string; status:OutboxStatus; attempts:number; nextAttemptAt:string|null; createdAt:string; updatedAt:string; leaseId?:string; leaseExpiresAt?:string; deliveredAt?:string; outcome?:DeliveryOutcome; lastHttpStatus?:number; lastError?:string }
type Store={events:OutboxItem[]}
type AuthoritativeOrder={id:string;salesOrderNumber:string;customerName:string;currency?:string}
const FILE='payments-payouts-outbox.json',EMPTY:Store={events:[]}
export const PAYOUTS_EVENTS_URL='https://payouts.bsmindia.com/api/integrations/payments/events'
export const RETRY_DELAYS_MS=[60_000,300_000,900_000,3_600_000,21_600_000] as const
export const DELIVERY_LEASE_MS=30_000
const outcomes=new Set<DeliveryOutcome>(['matched','unmatched','company_mismatch','duplicate','manual_review'])

function secret(){const value=process.env.PAYOUTS_INTEGRATION_SECRET?.trim();if(!value)throw new Error('PAYOUTS_INTEGRATION_SECRET is not configured');return value}
function endpoint(){const explicit=process.env.PAYOUTS_EVENTS_URL?.trim();if(explicit)return explicit;const base=process.env.PAYOUTS_BASE_URL?.trim().replace(/\/$/,'');return base?`${base}/api/integrations/payments/events`:PAYOUTS_EVENTS_URL}
function iso(value:string){const date=new Date(value);if(!value||!Number.isFinite(date.getTime()))throw new Error('Payment receivedAt must be a valid ISO date');return date.toISOString()}
function decimal(value:number){if(!Number.isFinite(value)||Math.abs(value*100-Math.round(value*100))>1e-7)throw new Error('Payment amount must be positive with at most two decimal places');const minor=toPaise(value);if(!Number.isSafeInteger(minor)||minor<=0)throw new Error('Payment amount must be positive with at most two decimal places');return `${Math.floor(minor/100)}.${String(minor%100).padStart(2,'0')}`}
export function eventIdFor(paymentId:string,type:PaymentEventType,stateVersion:string){return `payevt_${createHash('sha256').update(`v1\n${paymentId}\n${type}\n${stateVersion}`).digest('hex')}`}
export function paymentEvent(payment:Payment,type:PaymentEventType,order:AuthoritativeOrder={id:payment.salesOrderId||'',salesOrderNumber:payment.salesOrderNumber||'',customerName:payment.customerName,currency:'INR'}):PaymentEvent{
  if(!payment.salesOrderId||order.id!==payment.salesOrderId||!order.salesOrderNumber||!order.customerName)throw new Error('Payment must reference an authoritative linked order')
  if((order.currency||'INR').toUpperCase()!=='INR')throw new Error('Only INR payments can be synchronized')
  const event:PaymentEvent={type:`payment.${type}`,payment:{id:payment.id,salesOrderNumber:order.salesOrderNumber,companyName:order.customerName,currency:'INR',receivedAt:iso(payment.confirmedAt||payment.paymentDate||payment.updatedAt)}}
  if(type==='received'||type==='updated')event.payment.amount=decimal(payment.paymentAmount)
  return event
}
export function signBody(body:string,timestamp:string,eventId:string,sharedSecret:string){return createHmac('sha256',sharedSecret).update(Buffer.concat([Buffer.from(`${timestamp}.${eventId}.`,'utf8'),Buffer.from(body,'utf8')])).digest('hex')}
export function verifySignature(body:string,timestamp:string,eventId:string,signature:string,sharedSecret:string){const expected=Buffer.from(signBody(body,timestamp,eventId,sharedSecret),'hex'),actual=Buffer.from(signature.replace(/^sha256=/i,''),'hex');return expected.length===actual.length&&timingSafeEqual(expected,actual)}
export async function enqueuePaymentEvent(payment:Payment,type:PaymentEventType,resolver:(id:string,number:string,customer?:string)=>Promise<AuthoritativeOrder|null>=validatePaymentOrder){
  if(!payment.salesOrderId||!payment.salesOrderNumber)throw new Error('Cannot synchronize an unlinked payment')
  const order=await resolver(payment.salesOrderId,payment.salesOrderNumber)
  if(!order)throw new Error('Linked sales order could not be authoritatively validated')
  const event=paymentEvent(payment,type,order),eventId=eventIdFor(payment.id,type,payment.updatedAt),body=JSON.stringify(event);let item!:OutboxItem
  await updateLocalJson(FILE,EMPTY,store=>{const existing=store.events.find(entry=>entry.eventId===eventId);if(existing){item=existing;return store}const now=new Date().toISOString();item={eventId,event,body,paymentVersion:payment.updatedAt,status:'pending',attempts:0,nextAttemptAt:now,createdAt:now,updatedAt:now};return{events:[item,...store.events]}});return item
}
function message(error:unknown){return error instanceof Error?error.message:String(error)}
export async function deliverOutboxEvent(eventId:string,fetcher:typeof fetch=fetch,now=new Date()){
  let claimed:OutboxItem|undefined;const leaseId=randomUUID()
  await updateLocalJson(FILE,EMPTY,store=>({events:store.events.map(item=>{const expired=item.status==='delivering'&&(!item.leaseExpiresAt||Date.parse(item.leaseExpiresAt)<=now.getTime());if(item.eventId!==eventId||(!['pending','retrying'].includes(item.status)&&!expired)||(item.nextAttemptAt&&Date.parse(item.nextAttemptAt)>now.getTime()))return item;claimed={...item,status:'delivering',attempts:item.attempts+1,updatedAt:now.toISOString(),nextAttemptAt:null,leaseId,leaseExpiresAt:new Date(now.getTime()+DELIVERY_LEASE_MS).toISOString()};return claimed})}))
  if(!claimed)return null
  let response:Response|undefined,error:unknown
  try{const timestamp=Math.floor(now.getTime()/1000).toString(),sharedSecret=secret();response=await fetcher(endpoint(),{method:'POST',headers:{'Content-Type':'application/json','X-BSM-Event-ID':claimed.eventId,'X-BSM-Timestamp':timestamp,'X-BSM-Signature':`sha256=${signBody(claimed.body,timestamp,claimed.eventId,sharedSecret)}`},body:claimed.body,signal:AbortSignal.timeout(10_000)})}catch(cause){error=cause}
  let outcome:DeliveryOutcome|undefined
  if(response&&(response.status===200||response.status===202)){const parsed=await response.json().catch(()=>null) as {ok?:unknown;eventId?:unknown;outcome?:unknown}|null;if(parsed?.ok===true&&parsed.eventId===claimed.eventId&&outcomes.has(parsed.outcome as DeliveryOutcome))outcome=parsed.outcome as DeliveryOutcome;else error=new Error('Payouts returned an invalid success response')}
  const permanent=Boolean(response&&[400,401,403,409,422].includes(response.status)),delay=RETRY_DELAYS_MS[claimed.attempts-1]
  let result!:OutboxItem
  await updateLocalJson(FILE,EMPTY,store=>({events:store.events.map(item=>{if(item.eventId!==eventId||item.leaseId!==leaseId)return item;const at=new Date().toISOString();result={...item,updatedAt:at,lastHttpStatus:response?.status,lastError:outcome?undefined:(error?message(error):`HTTP ${response?.status}`),outcome,leaseId:undefined,leaseExpiresAt:undefined,...(outcome?{status:'delivered' as const,deliveredAt:at,nextAttemptAt:null}:permanent||delay===undefined?{status:'failed' as const,nextAttemptAt:null}:{status:'retrying' as const,nextAttemptAt:new Date(now.getTime()+delay).toISOString()})};return result})}));return result||null
}
export async function enqueueAndDeliver(payment:Payment,type:PaymentEventType,fetcher:typeof fetch=fetch,authoritativeOrder?:AuthoritativeOrder){const item=await enqueuePaymentEvent(payment,type,authoritativeOrder?async()=>authoritativeOrder:validatePaymentOrder);return item.status==='delivered'?item:deliverOutboxEvent(item.eventId,fetcher)}
/** Recover payment mutations committed before a separate outbox write failed. */
export async function reconcileMissingPaymentEvents(){const payments=(await readLocalJsonFresh<{payments:Payment[]}>('payments.json',{payments:[]})).payments;const existing=new Set((await readLocalJsonFresh(FILE,EMPTY)).events.map(item=>item.eventId));const missing=payments.flatMap(payment=>(payment.payoutSyncIntents||[]).map(intent=>({payment,intent,eventId:eventIdFor(payment.id,intent.type,intent.version)}))).filter(candidate=>!existing.has(candidate.eventId)).sort((a,b)=>a.eventId.localeCompare(b.eventId));let recovered=0;for(const {payment,intent,eventId} of missing){if(existing.has(eventId))continue;const snapshot={...payment,paymentAmount:intent.paymentAmount,paymentDate:intent.paymentDate,confirmedAt:intent.confirmedAt,salesOrderId:intent.salesOrderId,salesOrderNumber:intent.salesOrderNumber,customerName:intent.customerName,updatedAt:intent.version};await enqueuePaymentEvent(snapshot,intent.type,async()=>({id:intent.salesOrderId,salesOrderNumber:intent.salesOrderNumber,customerName:intent.customerName,currency:'INR'}));existing.add(eventId);recovered++}return recovered}
export async function processDueOutbox(fetcher:typeof fetch=fetch,now=new Date(),limit=25){await reconcileMissingPaymentEvents();const store=await readLocalJsonFresh(FILE,EMPTY),due=store.events.filter(item=>!['delivered','failed'].includes(item.status)&&((item.status==='delivering'&&(!item.leaseExpiresAt||Date.parse(item.leaseExpiresAt)<=now.getTime()))||(['pending','retrying'].includes(item.status)&&(!item.nextAttemptAt||Date.parse(item.nextAttemptAt)<=now.getTime())))).slice(0,limit),results=[] as OutboxItem[];for(const item of due){const result=await deliverOutboxEvent(item.eventId,fetcher,now);if(result)results.push(result)}return results}
export async function retryOutboxEvent(eventId:string,fetcher:typeof fetch=fetch){const now=new Date();let found=false;await updateLocalJson(FILE,EMPTY,store=>({events:store.events.map(item=>{if(item.eventId!==eventId)return item;found=true;if(item.status==='delivering'&&item.leaseExpiresAt&&Date.parse(item.leaseExpiresAt)>now.getTime())return item;return{...item,status:'pending' as const,nextAttemptAt:now.toISOString(),updatedAt:now.toISOString(),lastError:undefined,leaseId:undefined,leaseExpiresAt:undefined}})}));return found?deliverOutboxEvent(eventId,fetcher,now):null}
export async function listOutbox(){return(await readLocalJsonFresh(FILE,EMPTY)).events}
export async function paymentSyncStatus(paymentId:string){const events=(await listOutbox()).filter(item=>item.event.payment.id===paymentId);return events.length?events.sort((a,b)=>b.paymentVersion.localeCompare(a.paymentVersion))[0]:null}
