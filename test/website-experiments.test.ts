import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {enroll,recordExperiment,withdraw,controlExperiment,variantFor,wilson,WINDOW_MS,homepageConfiguration,experimentReport,preparedDesign,validEnrollment,experimentControl} from '../src/analytics/website-experiments.js';
import type {Firestore} from 'firebase-admin/firestore';
function database(){
 const docs=new Map<string,any>();
 const ref=(path:string):any=>({path,get:async()=>({exists:docs.has(path),data:()=>structuredClone(docs.get(path))})});
 const db:any={doc:ref,collection:(path:string)=>({doc:(id=randomUUID())=>ref(path+'/'+id),get:async()=>({docs:[...docs.keys()].filter(k=>k.startsWith(path+'/')).map(k=>({id:k.slice(path.length+1),data:()=>structuredClone(docs.get(k))}))})})};
 db.runTransaction=async(fn:any)=>{let written=false;return fn({get:async(r:any)=>{if(written)throw Error('Read after write');return r.get()},create:(r:any,data:any)=>{written=true;if(docs.has(r.path))throw Error('Already exists');docs.set(r.path,structuredClone(data))},update:(r:any,data:any)=>{written=true;docs.set(r.path,{...docs.get(r.path),...structuredClone(data)})},set:(r:any,data:any)=>{written=true;docs.set(r.path,structuredClone(data))},delete:(r:any)=>{written=true;docs.delete(r.path)}})};
 return {db:db as Firestore,docs};
}
const visitor={visitorId:'550e8400-e29b-41d4-a716-446655440000',locale:'fr',device:'mobile',source:'direct'};
describe('homepage experiment measurement',()=>{
 it('does not enroll before an admin starts an experiment; persists 50/50 assignments',async()=>{
  const {db}=database();expect(await enroll(db,visitor,'FR',1000)).toBeNull();
  const config=await controlExperiment(db,{action:'start',name:'Hero comparison'},'admin');
  const first=await enroll(db,visitor,'FR',1000);expect(first).toEqual(await enroll(db,visitor,'FR',2000));expect(first?.variant).toBe(variantFor(config.id!,visitor.visitorId));
  await controlExperiment(db,{action:'pause'},'admin');expect(await enroll(db,visitor,'FR',2000)).toEqual(first);expect(await enroll(db,{...visitor,visitorId:randomUUID()},'FR',2000)).toBeNull();
 });
 it('deduplicates exposures, clicks, paid transactions, and paying browsers separately',async()=>{
  const {db,docs}=database();await controlExperiment(db,{action:'start',name:'Hero'},'admin');const e=(await enroll(db,visitor,'FR',1000))!;
  await recordExperiment(db,e.token,'shop_click',undefined,1100);expect(docs.size).toBe(4);
  for(let i=0;i<2;i++)await recordExperiment(db,e.token,'exposure',undefined,1200);
  for(let i=0;i<2;i++)await recordExperiment(db,e.token,'shop_click',undefined,1300);
  for(let i=0;i<3;i++)await recordExperiment(db,e.token,'purchase',{id:'cs_verified',amount:5999,currency:'eur'},1500);
  await recordExperiment(db,e.token,'purchase',{id:'in_verified',amount:699,currency:'usd'},1800);
  const v=docs.get('websiteExperimentResults/'+e.experimentId).variants[e.variant];
  expect(v).toMatchObject({exposure:1,shop_click:1,purchases:1,transactions:2,revenue:{EUR:5999,USD:699}});
 });
 it('does not count free or unpaid trials as sales, but records their later paid invoice',async()=>{
  const {db,docs}=database();await controlExperiment(db,{action:'start',name:'Hero'},'admin');const e=(await enroll(db,visitor,'FR',1000))!;
  await recordExperiment(db,e.token,'exposure',undefined,1200);await recordExperiment(db,e.token,'trial',undefined,1500);
  await recordExperiment(db,e.token,'purchase',{id:'in_zero',amount:0,currency:'usd'},1800);
  expect(docs.get('websiteExperimentResults/'+e.experimentId).variants[e.variant].purchases).toBeUndefined();
  await recordExperiment(db,e.token,'purchase',{id:'in_paid',amount:699,currency:'usd'},1000+3*86400000);
  expect(docs.get('websiteExperimentResults/'+e.experimentId).variants[e.variant].purchases).toBe(1);
 });
 it('blocks unknown tokens, expired windows, and tracking after consent withdrawal',async()=>{
  const {db,docs}=database();await controlExperiment(db,{action:'start',name:'Hero'},'admin');const e=(await enroll(db,visitor,'FR',1000))!;
  await recordExperiment(db,e.token,'exposure',undefined,1200);
  await recordExperiment(db,e.token,'purchase',{id:'late',amount:699,currency:'usd'},1001+WINDOW_MS);
  await withdraw(db,e.token);await recordExperiment(db,e.token,'purchase',{id:'withdrawn',amount:699,currency:'usd'},1500);
  await recordExperiment(db,'a'.repeat(64),'exposure',undefined,1500);
  expect(docs.get('websiteExperimentResults/'+e.experimentId).variants[e.variant].purchases).toBeUndefined();
 });
 it('reports uncertainty even when there are no purchases',()=>{expect(wilson(0,100)[1]).toBeGreaterThan(.03);expect(wilson(0,0)).toEqual([0,1])});
 it('promotes a frozen page, stops assignment for returning visitors and keeps paid attribution',async()=>{
  const {db,docs}=database();const test=await controlExperiment(db,{action:'start',name:'Prepared pair',design:preparedDesign},'admin');
  const e=(await enroll(db,visitor,'FR',1000))!;await recordExperiment(db,e.token,'exposure',undefined,1100);
  await controlExperiment(db,{action:'promote',design:preparedDesign,variant:'B'},'admin');
  expect(await homepageConfiguration(db)).toEqual({defaultPage:{design:preparedDesign,variant:'B'}});
  expect(await enroll(db,visitor,'FR',1200)).toBeNull();
  await expect(controlExperiment(db,{action:'resume'},'admin')).rejects.toThrow('ended');
  await recordExperiment(db,e.token,'purchase',{id:'cs_after_promotion',amount:1000,currency:'eur'},1300);
  expect(docs.get('websiteExperimentResults/'+e.experimentId).variants[e.variant].purchases).toBe(1);
  expect(docs.get('websiteExperiments/'+test.id).design).toBe(preparedDesign);
  const next=await controlExperiment(db,{action:'start',name:'Next comparison',design:preparedDesign},'admin');
  expect(next.id).not.toBe(test.id);expect((await homepageConfiguration(db)).defaultPage.variant).toBe('B');
 });
 it('deletes only paused test results, keeps the promoted default and prevents late event resurrection',async()=>{
  const {db,docs}=database();const test=await controlExperiment(db,{action:'start',name:'Delete me'},'admin');
  const e=(await enroll(db,visitor,'FR',1000))!;await recordExperiment(db,e.token,'exposure',undefined,1100);
  await expect(controlExperiment(db,{action:'delete',id:test.id!},'admin')).rejects.toThrow('Pause');
  await controlExperiment(db,{action:'promote',design:preparedDesign,variant:'B'},'admin');
  docs.set('websiteOrders/real-order',{amount:1000});
  await controlExperiment(db,{action:'delete',id:test.id!},'admin');
  expect(await validEnrollment(db,e.token,1200)).toBeNull();
  await recordExperiment(db,e.token,'purchase',{id:'cs_late',amount:1000,currency:'eur'},1200);
  await recordExperiment(db,e.token,'shop_click',undefined,1200);
  expect(docs.has('websiteExperimentResults/'+test.id)).toBe(false);
  expect(docs.get('websiteOrders/real-order')).toEqual({amount:1000});
  expect((await homepageConfiguration(db)).defaultPage.variant).toBe('B');
  const report=await experimentReport(db,test.id);expect(report.history).toEqual([]);expect(report.selected).toBeNull();expect(report.current).toBeNull();
 });
 it('deletes an older test without changing a different active experiment',async()=>{
  const {db}=database();const first=await controlExperiment(db,{action:'start',name:'Old comparison'},'admin');await controlExperiment(db,{action:'pause'},'admin');
  const next=await controlExperiment(db,{action:'start',name:'New comparison'},'admin');
  await controlExperiment(db,{action:'delete',id:first.id!},'admin');
  expect((await experimentReport(db)).current).toMatchObject({id:next.id,active:true});
 });
 it('rejects unknown versions, stale prepared previews and malformed administrative commands',async()=>{
  const {db}=database();await expect(controlExperiment(db,{action:'promote',design:'page-unknown',variant:'A'},'admin')).rejects.toThrow('Unknown');
  await expect(controlExperiment(db,{action:'start',name:'Stale preview',design:'old'},'admin')).rejects.toThrow('Reload');
  for(const input of [{action:'delete',id:'../current'},{action:'promote',design:preparedDesign,variant:'C'},{action:'start',name:'Hi'},{action:'delete',id:randomUUID(),force:true}])expect(experimentControl.safeParse(input).success).toBe(false);
 });
});
