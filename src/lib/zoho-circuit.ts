import { readLocalJsonFresh, updateLocalJson } from './local-store'

const FILE='zoho-circuit.json'
type Circuit={version:1;failureClass:string;failureCount:number;nextEligibleAt:string;lastFailureAt:string;lastSuccessAt:string}
const EMPTY:Circuit={version:1,failureClass:'',failureCount:0,nextEligibleAt:'',lastFailureAt:'',lastSuccessAt:''}
export class ZohoBackoffError extends Error { constructor(public nextEligibleAt:string,message='Zoho is temporarily unavailable'){super(message);this.name='ZohoBackoffError'} }
const quotaText=(status:number,message:string)=>status===429||/quota|rate.?limit|too many request|api usage/i.test(message)
export function classifyZohoFailure(status:number,message:string){return quotaText(status,message)?'quota':status>=500?'server':status===401||status===403?'auth':'request'}
export async function assertZohoEligible(now=Date.now()){
 const state=await readLocalJsonFresh(FILE,EMPTY)
 if(state.nextEligibleAt&&Date.parse(state.nextEligibleAt)>now)throw new ZohoBackoffError(state.nextEligibleAt)
 return state
}
export async function recordZohoSuccess(now=new Date()){return updateLocalJson(FILE,EMPTY,s=>({...s,version:1 as const,failureClass:'',failureCount:0,nextEligibleAt:'',lastSuccessAt:now.toISOString()}))}
export async function recordZohoFailure(status:number,message:string,retryAfterSeconds?:number,now=new Date()){
 const failureClass=classifyZohoFailure(status,message)
 return updateLocalJson(FILE,EMPTY,s=>{
  const count=Math.min(12,(s.failureCount||0)+1)
  const base=failureClass==='quota'?60*60_000:failureClass==='auth'?30*60_000:60_000
  const bounded=Math.min(failureClass==='quota'?24*60*60_000:60*60_000,base*2**Math.min(count-1,8))
  const delay=Math.max(bounded,(retryAfterSeconds||0)*1000)
  return {...s,version:1 as const,failureClass,failureCount:count,lastFailureAt:now.toISOString(),nextEligibleAt:new Date(now.getTime()+delay).toISOString()}
 })
}
export async function zohoCircuitStatus(){return readLocalJsonFresh(FILE,EMPTY)}
