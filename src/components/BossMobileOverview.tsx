"use client";
import {useId,useMemo,useState} from "react";
import type {Payment} from "@/lib/payments";
import {paymentChartBuckets,paymentCountLabel,type ChartBucket,type ViewerPeriod} from "@/lib/viewer-payment-metrics";
import {BossReceivedPaymentsHero} from "./BossReceivedPaymentsHero";
const periods:ViewerPeriod[]=['day','week','month'];
const periodName:Record<ViewerPeriod,string>={day:'Day',week:'Week',month:'Month'};
const money=(paise:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:0,maximumFractionDigits:0}).format(paise/100);
export function BossMobileOverview({payments}:{payments:Payment[]}){return <div className="boss-mobile-overview" data-viewer-screen="overview"><BossReceivedPaymentsHero payments={payments}/><PaymentChart title="Total Payments" kind="total" payments={payments}/><PaymentChart title="Total Pending Payments" kind="pending" payments={payments}/></div>}
function PaymentChart({title,kind,payments}:{title:string;kind:'total'|'pending';payments:Payment[]}){
 const [period,setPeriod]=useState<ViewerPeriod>('day'),[active,setActive]=useState<number|null>(null),id=useId();
 const buckets=useMemo(()=>paymentChartBuckets(payments,period,kind),[payments,period,kind]);
 const max=Math.max(1,...buckets.map(x=>x.amountPaise)),width=600,height=190,pad=22;
 const points=buckets.map((b,i)=>({b,x:pad+(i*(width-pad*2))/Math.max(1,buckets.length-1),y:height-pad-(b.amountPaise/max)*(height-pad*2)}));
 const path=points.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '),selected=active===null?null:points[active];
 const choose=(clientX:number,element:SVGSVGElement)=>{const r=element.getBoundingClientRect(),x=((clientX-r.left)/r.width)*width;let nearest=0;points.forEach((p,i)=>{if(Math.abs(p.x-x)<Math.abs(points[nearest].x-x))nearest=i});setActive(nearest)};
 return <article className="boss-chart-card"><header><div><span>Analytics</span><h2>{title}</h2></div><strong>{money(buckets.reduce((n,b)=>n+b.amountPaise,0))}</strong></header><div className="boss-chart-period" role="group" aria-label={`${title} period`}>{periods.map(p=><button key={p} type="button" aria-pressed={period===p} onClick={()=>{setPeriod(p);setActive(null)}}>{periodName[p]}</button>)}</div><div className="boss-chart-stage">
  {selected&&<div className="boss-chart-tooltip" role="status" style={{left:`${selected.x/width*100}%`,top:`${Math.max(6,selected.y/height*100-5)}%`}}><strong>{money(selected.b.amountPaise)}</strong><span>{paymentCountLabel(selected.b.count)}</span><small>{selected.b.label}</small></div>}
  <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-desc`} tabIndex={0} onPointerMove={e=>choose(e.clientX,e.currentTarget)} onPointerDown={e=>choose(e.clientX,e.currentTarget)} onPointerLeave={()=>setActive(null)} onBlur={()=>setActive(null)} onKeyDown={e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();setActive(v=>Math.max(0,Math.min(points.length-1,(v??0)+(e.key==='ArrowRight'?1:-1))))}}}>
   <title id={`${id}-title`}>{title}</title><desc id={`${id}-desc`}>{periodName[period]} payment amounts. Use arrow keys to inspect buckets.</desc>
   {[.25,.5,.75,1].map(v=><line key={v} x1={pad} x2={width-pad} y1={height-pad-v*(height-pad*2)} y2={height-pad-v*(height-pad*2)} className="chart-grid"/>)}
   <path d={`${path} L${width-pad} ${height-pad} L${pad} ${height-pad} Z`} className="chart-area"/><path d={path} className="chart-line"/>
   {points.map((p,i)=><circle key={p.b.key} cx={p.x} cy={p.y} r={active===i?6:3.5} className="chart-point" onPointerEnter={()=>setActive(i)}><title>{`${p.b.label}: ${money(p.b.amountPaise)}, ${paymentCountLabel(p.b.count)}`}</title></circle>)}
  </svg><div className="boss-chart-axis"><span>{buckets[0]?.label}</span><span>{buckets.at(-1)?.label}</span></div></div></article>
}
