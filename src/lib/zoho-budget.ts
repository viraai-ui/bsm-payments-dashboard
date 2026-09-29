import { readLocalJsonFresh, updateLocalJson } from './local-store'

const FILE='zoho-daily-budget.json'
export const PAYMENT_ZOHO_DAILY_LIMIT=1500
const IST_OFFSET_MS=330*60_000
export type ZohoDailyBudget={version:1;day:string;attempted:number;limit:number;updatedAt:string}
const empty=():ZohoDailyBudget=>({version:1,day:'',attempted:0,limit:PAYMENT_ZOHO_DAILY_LIMIT,updatedAt:''})

export function istBudgetWindow(now=new Date()){
 const shifted=now.getTime()+IST_OFFSET_MS,date=new Date(shifted),day=date.toISOString().slice(0,10)
 const nextMidnightUtc=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()+1)-IST_OFFSET_MS
 return{day,nextResetAt:new Date(nextMidnightUtc).toISOString()}
}

/** Atomically reserve one provider business call before it is issued. The
 * production backend is the same remote CAS store as the payment mirror; no
 * serverless filesystem state is used. This is a Payments-only allocation and
 * does not claim to coordinate other applications sharing the Zoho org quota. */
export async function reserveZohoBusinessCall(now=new Date()){
 const window=istBudgetWindow(now);let allowed=false
 const state=await updateLocalJson<ZohoDailyBudget>(FILE,empty(),current=>{
  const attempted=current.day===window.day?Number(current.attempted||0):0
  if(attempted>=PAYMENT_ZOHO_DAILY_LIMIT)return{version:1,day:window.day,attempted,limit:PAYMENT_ZOHO_DAILY_LIMIT,updatedAt:now.toISOString()}
  allowed=true;return{version:1,day:window.day,attempted:attempted+1,limit:PAYMENT_ZOHO_DAILY_LIMIT,updatedAt:now.toISOString()}
 })
 return{allowed,state,nextResetAt:window.nextResetAt}
}
export async function zohoDailyBudgetStatus(now=new Date()){
 const window=istBudgetWindow(now),state=await readLocalJsonFresh(FILE,empty())
 return state.day===window.day?{...state,nextResetAt:window.nextResetAt}:{...empty(),day:window.day,limit:PAYMENT_ZOHO_DAILY_LIMIT,nextResetAt:window.nextResetAt}
}
