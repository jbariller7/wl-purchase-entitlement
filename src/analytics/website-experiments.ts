import { createHash, randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { HttpError } from '../http/auth.js';
export const WINDOW_MS=14*86400000;
export const experimentToken=z.string().regex(/^[a-f0-9]{64}$/);
export const eventName=z.enum(['exposure','demo_click','shop_click','steam_click','android_click','trailer_click','checkout','trial']);
type EventName=z.infer<typeof eventName>;
type Enrollment={experimentId:string;variant:'A'|'B';createdAt:number;locale:string;device:string;country:string;source:string;withdrawn?:boolean;events?:Record<string,boolean>;purchased?:boolean};
export function variantFor(experimentId:string,visitorId:string):'A'|'B'{return parseInt(createHash('sha256').update(experimentId+':'+visitorId).digest('hex').slice(0,8),16)%2?'B':'A'}
export function eligible(e:Enrollment|undefined,now:number){return Boolean(e&&!e.withdrawn&&now>=e.createdAt&&now-e.createdAt<=WINDOW_MS)}
export function wilson(success:number,total:number){if(!total)return [0,1];const z=1.96,p=success/total,d=1+z*z/total,c=(p+z*z/(2*total))/d,h=z*Math.sqrt((p*(1-p)+z*z/(4*total))/total)/d;return [Math.max(0,c-h),Math.min(1,c+h)]}
export async function enroll(db:Firestore,input:{visitorId:string;locale:string;device:string;source:string},country:string,now=Date.now()){
 return db.runTransaction(async tx=>{const config=await tx.get(db.doc('websiteExperiments/current'));const c=config.data();if(!c?.id)return null;
 const token=createHash('sha256').update(c.id+':'+input.visitorId).digest('hex'),ref=db.doc('websiteExperimentEnrollments/'+token),existing=await tx.get(ref);
 const e=(existing.data()||{experimentId:c.id,variant:variantFor(c.id,input.visitorId),createdAt:now,locale:input.locale,device:input.device,country,source:input.source}) as Enrollment;
 if(!eligible(e,now)||(!existing.exists&&!c.active))return null;if(!existing.exists)tx.create(ref,e);
 return {token,experimentId:e.experimentId,variant:e.variant};});
}
export async function validEnrollment(db:Firestore,token:string|undefined,now=Date.now()) {if(!token||!experimentToken.safeParse(token).success)return null;const e=(await db.doc('websiteExperimentEnrollments/'+token).get()).data() as Enrollment|undefined;return eligible(e,now)?e!:null}
export async function withdraw(db:Firestore,token:string){const ref=db.doc('websiteExperimentEnrollments/'+token);await db.runTransaction(async tx=>{if((await tx.get(ref)).exists)tx.update(ref,{withdrawn:true})})}
export async function recordExperiment(db:Firestore,token:string|undefined,event:EventName|'purchase',payment?:{id:string;amount:number;currency:string},now=Date.now()){
 if(!token||!experimentToken.safeParse(token).success)return;
 if(event==='purchase'&&(!payment||!Number.isSafeInteger(payment.amount)||payment.amount<=0||!/^[a-z]{3}$/i.test(payment.currency)))return;
 await db.runTransaction(async tx=>{
  const ref=db.doc('websiteExperimentEnrollments/'+token),snap=await tx.get(ref),e=snap.data() as Enrollment|undefined;
  if(!eligible(e,now)||!e)return;
  // Count only visitors who actually saw the assigned page. Purchase attribution
  // uses the enrollment on the verified order, never a browser-provided variant.
  if(event!=='exposure'&&!e.events?.exposure)return;
  if(event!=='purchase'&&e.events?.[event])return;
  const resultRef=db.doc('websiteExperimentResults/'+e.experimentId),result=await tx.get(resultRef);
  const receipt=payment?db.doc('websiteExperimentReceipts/'+createHash('sha256').update(payment.id).digest('hex')):null;
  if(receipt&&(await tx.get(receipt)).exists)return;
  const data=result.data()||{},variants=data.variants||{},v=variants[e.variant]||{};
  if(event==='purchase'){
   v.purchases=(v.purchases||0)+(e.purchased?0:1);v.transactions=(v.transactions||0)+1;
   const currency=payment!.currency.toUpperCase();v.revenue={...v.revenue,[currency]:(v.revenue?.[currency]||0)+payment!.amount};tx.update(ref,{purchased:true});
   tx.create(receipt!,{experimentId:e.experimentId,variant:e.variant,recordedAt:now,amount:payment!.amount,currency});
  }else{v[event]=(v[event]||0)+1;tx.update(ref,{events:{...e.events,[event]:true}})}
  variants[e.variant]=v;
  const segments=data.segments||{};
  for(const [dimension,value] of Object.entries({locale:e.locale,device:e.device,country:e.country,source:e.source})){
   const key=dimension+':'+value+':'+e.variant,segment=segments[key]||{};
   if(event!=='purchase'||!e.purchased)segment[event]=(segment[event]||0)+1;segments[key]=segment;
  }
  tx.set(resultRef,{variants,segments,updatedAt:now});
 });
}
export const experimentControl=z.object({action:z.enum(['start','pause','resume']),name:z.string().trim().min(3).max(100).optional()}).strict();
export async function controlExperiment(db:Firestore,input:z.infer<typeof experimentControl>,actor:string){
 return db.runTransaction(async tx=>{const ref=db.doc('websiteExperiments/current'),snap=await tx.get(ref),previous=snap.data();
 if(input.action==='start'&&previous?.active)throw new HttpError(409,'Pause the current experiment before starting a new one.');
 if(input.action!=='start'&&!previous?.id)throw new HttpError(409,'Create an experiment first.');
 if(input.action==='start'&&!input.name)throw new HttpError(400,'Give the experiment a name.');
 const current=input.action==='start'?{id:randomUUID(),name:input.name,active:true,startedAt:Date.now(),design:'homepage-hero-v1',allocation:'50/50',windowDays:14}:{...previous,active:input.action==='resume'};
 tx.set(ref,current);tx.set(db.doc('websiteExperiments/'+current.id),current);tx.create(db.collection('adminAudit').doc(),{action:'website_experiment_'+input.action,actorUid:actor,targetId:current.id,createdAt:new Date().toISOString()});return current;});
}
export async function experimentReport(db:Firestore,id?:string){
 const current=(await db.doc('websiteExperiments/current').get()).data()||null;
 const history=await db.collection('websiteExperiments').get();
 const selected=id?(history.docs.find(d=>d.id===id)?.data()||null):current;
 const result=selected?(await db.doc('websiteExperimentResults/'+selected.id).get()).data()||{}:{};
 const variants=Object.fromEntries(['A','B'].map(key=>{const v=result.variants?.[key]||{};return [key,{...v,interval:wilson(v.purchases||0,v.exposure||0)}]}));
 return {current,selected,history:history.docs.filter(d=>d.id!=='current').map(d=>d.data()).sort((a,b)=>b.startedAt-a.startedAt),variants,segments:result.segments||{},updatedAt:result.updatedAt||null};
}
