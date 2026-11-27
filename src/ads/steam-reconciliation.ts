import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {UtmEvidence} from './steam-sources.js';
export const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export const steamReportSchema=z.object({
 appId:z.string().regex(/^\d{3,12}$/),country:z.string().regex(/^[A-Z]{2}$/),
 start:z.string().datetime({offset:true}),end:z.string().datetime({offset:true}),
 units:z.number().int().min(0).max(1000),revenue:z.number().finite().min(0).max(1000000),currency:z.string().regex(/^[A-Z]{3}$/),
 sourceReference:z.string().trim().min(5).max(250),
 // Optional cohort evidence must be from the SAME product and window; never add
 // UTM purchases to the sales total (they are a subset, not extra purchases).
 utm:z.array(z.object({campaign:z.string().max(200),content:z.string().max(200),purchases:z.number().int().min(0).max(1000)}).strict()).max(100).default([])
}).strict().superRefine((r,c)=>{
 const duration=Date.parse(r.end)-Date.parse(r.start);
 if(duration<=0||duration>25*3600000)c.addIssue({code:'custom',message:'Use one sales day (up to 25 hours across daylight saving), including timezone offset.'});
 if(r.utm.reduce((n,x)=>n+x.purchases,0)>r.units)c.addIssue({code:'custom',message:'UTM purchases must be a subset of net sales.'});
 if(new Set(r.utm.map(x=>x.campaign+'\0'+x.content)).size!==r.utm.length)c.addIssue({code:'custom',message:'Duplicate UTM cohort.'});
 if(!r.units&&r.revenue)c.addIssue({code:'custom',message:'Revenue requires positive units.'});
});
export type SteamReport=z.infer<typeof steamReportSchema>;
export type SteamClick={id:string;visitorId:string;appId:string;country:string;createdAt:string;widget:string;page:string;utm:Record<string,string>;source:Record<string,string>;ipAddress?:string;userAgent?:string;consent:boolean};
export type SteamCandidate={click:SteamClick;score:number;reasons:string[];cohort:string;reportId:string;allocationId:string;utmEvidence?:UtmEvidence};
export const reportId=(r:SteamReport)=>hash([r.appId,r.country,new Date(r.start).toISOString(),new Date(r.end).toISOString()].join('|'));
export function overlaps(a:SteamReport,b:SteamReport){return a.appId===b.appId&&a.country===b.country&&Date.parse(a.start)<Date.parse(b.end)&&Date.parse(b.start)<Date.parse(a.end)}
export function candidates(r:SteamReport,clicks:SteamClick[],evidence:UtmEvidence[]=[]):SteamCandidate[]{
 const end=Date.parse(r.end),start=Date.parse(r.start),dedup=new Map<string,SteamClick>();
 // Latest click per browser/product in the 72-hour lookback. No IP-based identity
 // merging, unknown countries, or browser-supplied country assumptions.
 for(const c of clicks){const time=Date.parse(c.createdAt);if(!c.consent||c.appId!==r.appId||c.country!==r.country||time>end||time<start-72*3600000)continue;
  const old=dedup.get(c.visitorId);if(!old||c.createdAt>old.createdAt)dedup.set(c.visitorId,c);
 }
 return [...dedup.values()].map(click=>{
  const cohort=(click.utm.utm_campaign||'')+'\0'+(click.utm.utm_content||'');
  const u=r.utm.find(x=>x.campaign===click.utm.utm_campaign&&x.content===click.utm.utm_content&&x.purchases>0);
  const matching=evidence.filter(e=>e.appId===r.appId&&e.country===r.country&&Date.parse(click.createdAt)>=Date.parse(e.start)&&Date.parse(click.createdAt)<Date.parse(e.end)&&['source','medium','campaign','content','term'].every(k=>click.utm['utm_'+k]===(e as any)[k])).sort((a,b)=>Date.parse(a.end)-Date.parse(a.start)-(Date.parse(b.end)-Date.parse(b.start))||a.id.localeCompare(b.id));
  const utmEvidence=matching[0],sameWindow=Date.parse(click.createdAt)>=start;
  const score=30+(sameWindow?20:10)+(u||utmEvidence?.purchases?35:0)+(dedup.size===1?10:0);
  return {click,score,reasons:['Same app and country',sameWindow?'Click inside sales window':'Click in preceding 72 hours',u||utmEvidence?.purchases?'Reported purchases in this UTM cohort (not an individual receipt)':'No matching UTM purchase evidence',dedup.size===1?'Only observed browser (unobserved traffic may exist)':`${dedup.size} competing observed browsers`],cohort,reportId:reportId(r),allocationId:hash(reportId(r)+'|'+click.visitorId),...(utmEvidence?{utmEvidence}:{})};
 }).sort((a,b)=>b.score-a.score||a.click.createdAt.localeCompare(b.click.createdAt)||a.click.id.localeCompare(b.click.id));
}
export function propose(r:SteamReport,clicks:SteamClick[],threshold:number,used:Set<string>=new Set(),evidence:UtmEvidence[]=[]){
 const selected:SteamCandidate[]=[],cohorts=new Map<string,number>();
 const evidenceCounts=new Map<string,number>();
 for(const c of candidates(r,clicks,evidence)){
  if(selected.length>=r.units)break;
  if(c.score<threshold||used.has(hash(c.click.visitorId+'|'+c.click.appId)))continue;
  const evidence=r.utm.find(x=>x.campaign+'\0'+x.content===c.cohort);
  if(evidence&&(cohorts.get(c.cohort)||0)>=evidence.purchases)continue;
  if(c.utmEvidence&&(evidenceCounts.get(c.utmEvidence.id)||0)>=c.utmEvidence.purchases)continue;
  selected.push(c);cohorts.set(c.cohort,(cohorts.get(c.cohort)||0)+1);
  if(c.utmEvidence)evidenceCounts.set(c.utmEvidence.id,(evidenceCounts.get(c.utmEvidence.id)||0)+1);
 }
 return selected;
}
export function conversionPayload(r:SteamReport,c:SteamCandidate,eventName:'Purchase'|'SteamPurchaseEstimate'){
 return {eventName,eventId:'steam-model-v1:'+c.allocationId,
  // The report gives a time WINDOW, not an individual transaction time.
  eventTime:Math.floor((Date.parse(r.end)-1000)/1000),actionSource:'other',
  eventSourceUrl:'https://store.steampowered.com/app/'+r.appId+'/',
  ...(c.click.source.fbc?{fbc:c.click.source.fbc}:{}),...(c.click.source.fbp?{fbp:c.click.source.fbp}:{}),
  ...(c.click.ipAddress?{ipAddress:c.click.ipAddress}:{}),...(c.click.userAgent?{userAgent:c.click.userAgent}:{}),
  value:r.units?r.revenue/r.units:0,currency:r.currency,product:'steam_app_'+r.appId,
  conversionKind:'steam_modelled_purchase',modelScore:c.score,modelVersion:'steam-cohort-v1',timePrecision:'sales_window',reportId:reportId(r),steamClickId:c.click.id,steamVisitorHash:hash(c.click.visitorId)};
}
