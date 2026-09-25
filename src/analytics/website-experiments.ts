import { createHash, randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { HttpError } from '../http/auth.js';
import designs from './website-designs.json' with { type: 'json' };
export const preparedDesign = designs.current;
const knownDesign = (id:string) => designs.designs.some(d=>d.id===id);
const designOf = (value:any):string => knownDesign(value?.design) ? value.design : designs.fallback;
export async function homepageConfiguration(db:Firestore) {
 const saved=(await db.doc('websitePageSettings/default').get()).data();
 return {defaultPage:{design:designOf(saved),variant:saved?.variant==='B'?'B':'A'}};
}
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
 if(c.endedAt||c.deletedAt)return null;
 const token=createHash('sha256').update(c.id+':'+input.visitorId).digest('hex'),ref=db.doc('websiteExperimentEnrollments/'+token),existing=await tx.get(ref);
 const e=(existing.data()||{experimentId:c.id,variant:variantFor(c.id,input.visitorId),createdAt:now,locale:input.locale,device:input.device,country,source:input.source}) as Enrollment;
 if(!eligible(e,now)||(!existing.exists&&!c.active))return null;if(!existing.exists)tx.create(ref,e);
 return {token,experimentId:e.experimentId,variant:e.variant,design:designOf(c)};});
}
export async function validEnrollment(db:Firestore,token:string|undefined,now=Date.now()) {if(!token||!experimentToken.safeParse(token).success)return null;const e=(await db.doc('websiteExperimentEnrollments/'+token).get()).data() as Enrollment|undefined;if(!eligible(e,now)||!e)return null;const parent=(await db.doc('websiteExperiments/'+e.experimentId).get()).data();return parent?.deletedAt?null:e}
export async function withdraw(db:Firestore,token:string){const ref=db.doc('websiteExperimentEnrollments/'+token);await db.runTransaction(async tx=>{if((await tx.get(ref)).exists)tx.update(ref,{withdrawn:true})})}
export async function recordExperiment(db:Firestore,token:string|undefined,event:EventName|'purchase',payment?:{id:string;amount:number;currency:string},now=Date.now()){
 if(!token||!experimentToken.safeParse(token).success)return;
 if(event==='purchase'&&(!payment||!Number.isSafeInteger(payment.amount)||payment.amount<=0||!/^[a-z]{3}$/i.test(payment.currency)))return;
 await db.runTransaction(async tx=>{
  const ref=db.doc('websiteExperimentEnrollments/'+token),snap=await tx.get(ref),e=snap.data() as Enrollment|undefined;
  if(!eligible(e,now)||!e)return;
  if((await tx.get(db.doc('websiteExperiments/'+e.experimentId))).data()?.deletedAt)return;
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
export const experimentControl=z.discriminatedUnion('action',[
 z.object({action:z.literal('start'),name:z.string().trim().min(3).max(100),design:z.string().optional()}).strict(),
 z.object({action:z.literal('pause')}).strict(),
 z.object({action:z.literal('resume')}).strict(),
 z.object({action:z.literal('delete'),id:z.string().uuid()}).strict(),
 z.object({action:z.literal('promote'),design:z.string(),variant:z.enum(['A','B'])}).strict()
]);
export async function controlExperiment(db:Firestore,input:z.infer<typeof experimentControl>,actor:string){
 return db.runTransaction(async tx=>{const ref=db.doc('websiteExperiments/current'),snap=await tx.get(ref),previous=snap.data();
 const now=Date.now();
 const audit=(targetId:string)=>tx.create(db.collection('adminAudit').doc(),{action:'website_experiment_'+input.action,actorUid:actor,targetId,createdAt:new Date(now).toISOString()});
 if(input.action==='delete'){
  const target=db.doc('websiteExperiments/'+input.id),record=(await tx.get(target)).data();
  if(!record||record.deletedAt)throw new HttpError(404,'Experiment not found.');
  if(record.active||previous?.id===input.id&&previous.active)throw new HttpError(409,'Pause the experiment before deleting it.');
  // Keep a tombstone so delayed browser events and payment retries cannot recreate results.
  tx.set(target,{id:input.id,active:false,deletedAt:now});
  tx.delete(db.doc('websiteExperimentResults/'+input.id));
  if(previous?.id===input.id)tx.delete(ref);
  audit(input.id);return {deleted:true,id:input.id};
 }
 if(input.action==='promote'){
  if(!knownDesign(input.design))throw new HttpError(400,'Unknown page version.');
  const defaultPage={design:input.design,variant:input.variant,promotedAt:now};
  tx.set(db.doc('websitePageSettings/default'),defaultPage);
  if(previous?.id){const ended={...previous,active:false,endedAt:now};tx.set(ref,ended);tx.set(db.doc('websiteExperiments/'+previous.id),ended);}
  audit(input.design+':'+input.variant);return {defaultPage};
 }
 if(input.action==='start'&&previous?.active)throw new HttpError(409,'Pause the current experiment before starting a new one.');
 if(input.action!=='start'&&!previous?.id)throw new HttpError(409,'Create an experiment first.');
 if(input.action==='resume'&&previous?.endedAt)throw new HttpError(409,'This experiment has ended. Start a new experiment instead.');
 if(input.action==='start'&&input.design&&input.design!==preparedDesign)throw new HttpError(409,'The prepared versions changed. Reload and preview them before starting.');
 const current=input.action==='start'?{id:randomUUID(),name:input.name,active:true,startedAt:now,design:preparedDesign,allocation:'50/50',windowDays:14}:{...previous,active:input.action==='resume'};
 tx.set(ref,current);tx.set(db.doc('websiteExperiments/'+current.id),current);tx.create(db.collection('adminAudit').doc(),{action:'website_experiment_'+input.action,actorUid:actor,targetId:current.id,createdAt:new Date().toISOString()});return current;});
}
export async function experimentReport(db:Firestore,id?:string){
 const rawCurrent=(await db.doc('websiteExperiments/current').get()).data();
 const current:Record<string,any>|null=rawCurrent?.id&&!rawCurrent.deletedAt?{...rawCurrent,design:designOf(rawCurrent)}:null;
 const history=await db.collection('websiteExperiments').get();
 const visible:Array<Record<string,any>>=history.docs.filter(d=>d.id!=='current'&&!d.data().deletedAt).map(d=>({...d.data(),design:designOf(d.data())}));
 const selected=id?(visible.find(d=>d.id===id)||null):current;
 const result=selected?(await db.doc('websiteExperimentResults/'+selected.id).get()).data()||{}:{};
 const variants=Object.fromEntries(['A','B'].map(key=>{const v=result.variants?.[key]||{};return [key,{...v,interval:wilson(v.purchases||0,v.exposure||0)}]}));
 return {current,selected,history:visible.sort((a,b)=>b.startedAt-a.startedAt),variants,segments:result.segments||{},updatedAt:result.updatedAt||null,...await homepageConfiguration(db),prepared:designs.designs.find(d=>d.id===preparedDesign),designs:designs.designs};
}
