import {withLambda,type LambdaHandler} from '@netlify/aws-lambda-compat';
import {z} from 'zod';
import {firestore} from '../../src/infrastructure/firebase.js';
import {requireUser,requireAdmin,HttpError} from '../../src/http/auth.js';
import {json,errorResponse,parseJsonBody} from '../../src/http/response.js';
import {deploymentControls} from '../../src/config/env.js';
import {stableDocumentId} from '../../src/infrastructure/ids.js';
import {steamReportSchema,reportId,overlaps,propose,hash,conversionPayload,type SteamReport,type SteamClick} from '../../src/ads/steam-reconciliation.js';
import {loadSteamSheet,parseUtmExport,type UtmEvidence} from '../../src/ads/steam-sources.js';
const request=z.discriminatedUnion('action',[
 z.object({action:z.literal('sourceSales'),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).strict(),
 z.object({action:z.literal('importUtm'),filename:z.string().max(200),csv:z.string().max(1000000)}).strict(),
 z.object({action:z.literal('import'),report:steamReportSchema}).strict(),
 z.object({action:z.literal('preview'),id:z.string().regex(/^[a-f0-9]{64}$/),threshold:z.number().int().min(0).max(100)}).strict(),
 z.object({action:z.literal('approve'),id:z.string().regex(/^[a-f0-9]{64}$/),threshold:z.number().int().min(0).max(100),clickIds:z.array(z.string().uuid()).min(1).max(80),eventName:z.enum(['Purchase','SteamPurchaseEstimate']),acknowledgeModel:z.literal(true)}).strict()
]);
export const lambdaHandler:LambdaHandler=async event=>{try{
 const actor=requireAdmin(await requireUser(event.headers.authorization));const db=firestore(),now=Date.now();
 if(!['GET','POST'].includes(event.httpMethod))return json(405,{error:'Method not allowed'});
 const recent=new Date(now-30*86400000).toISOString();
 if(event.httpMethod==='GET'){
  const [clicks,reports,allocations]=await Promise.all([db.collection('steamClicks').where('createdAt','>=',recent).orderBy('createdAt','desc').limit(501).get(),db.collection('steamReports').where('importedAt','>=',recent).limit(501).get(),db.collection('steamAllocations').where('approvedAt','>=',recent).limit(501).get()]);
  const delivery=await Promise.all(allocations.docs.slice(0,500).map(async d=>{const a=d.data(),job=(await db.doc('outbox/'+String(a.jobId)).get()).data();return {id:d.id,...a,deliveryState:job?.result?.skipped?'skipped':job?.state||'unknown',eventsReceived:job?.result?.eventsReceived??null}}));
  return json(200,{clicks:clicks.docs.slice(0,500).map(d=>{const c=d.data();return {id:d.id,appId:c.appId,country:c.country,createdAt:c.createdAt,widget:c.widget,page:c.page,utm:c.utm,source:{adset_id:c.source?.adset_id,ad_id:c.source?.ad_id},hasFbc:!!c.source?.fbc}}),reports:reports.docs.slice(0,500).map(d=>({id:d.id,...d.data()})),allocations:delivery,truncated:clicks.size>500||reports.size>500||allocations.size>500});
 }
 if(event.headers.origin!=='https://wonderlang.app')throw new HttpError(403,'Invalid origin');
 if(event.isBase64Encoded||(event.body?.length||0)>1100000)throw new HttpError(400,'Invalid body');
 const parsed=request.safeParse(parseJsonBody(event.body));if(!parsed.success)throw new HttpError(400,parsed.error.issues.map(x=>x.message).join('; '));const input=parsed.data;
 if(input.action==='sourceSales')return json(200,await loadSteamSheet(input.date));
 if(input.action==='importUtm'){
  const rows=parseUtmExport(input.csv,input.filename);
  if(rows.some(r=>Date.parse(r.start)<now-30*86400000||Date.parse(r.end)>now))throw new HttpError(400,'Import a completed UTM visit window in the last 30 days.');
  await db.runTransaction(async tx=>{const lock=db.doc('steamSettings/utmImportLock');await tx.get(lock);const existing=await tx.get(db.collection('steamUtmEvidence').where('importedAt','>=',recent).limit(5001));if(existing.size>5000)throw new HttpError(409,'UTM evidence needs pagination before importing.');
   for(const r of rows){for(const d of existing.docs){const old=d.data() as unknown as UtmEvidence;if(d.id!==r.id&&['appId','country','source','medium','campaign','content','term'].every(k=>(old as any)[k]===(r as any)[k])&&Date.parse(old.start)<Date.parse(r.end)&&Date.parse(r.start)<Date.parse(old.end))throw new HttpError(409,'Overlapping UTM visit windows. Re-export the same window or use non-overlapping daily windows.');}}
   for(const r of rows){const old=existing.docs.find(d=>d.id===r.id)?.data();tx.set(db.doc('steamUtmEvidence/'+r.id),{...r,allocated:Number(old?.allocated||0),filename:input.filename,importedAt:new Date(now).toISOString(),actorUid:actor.uid});}
   tx.set(lock,{updatedAt:new Date(now).toISOString()});
  });return json(200,{imported:rows.length});
 }
 if(input.action==='import'){
  const r=input.report;if(Date.parse(r.end)>now||Date.parse(r.start)<now-30*86400000)throw new HttpError(400,'Import a completed sales window within the last 30 days.');
  const id=reportId(r),ref=db.doc('steamReports/'+id);
  // Serialize imports globally to prevent overlapping reports being imported concurrently.
  await db.runTransaction(async tx=>{const lock=db.doc('steamSettings/importLock');await tx.get(lock);const existing=await tx.get(ref);const all=await tx.get(db.collection('steamReports').where('importedAt','>=',recent).limit(1001));
   if(all.size>1000)throw new HttpError(409,'Too many reports: narrow/archive before importing.');
   if(existing.exists){if(JSON.stringify(existing.data()?.report)!==JSON.stringify(r))throw new HttpError(409,'This window is already imported with different data. Keep the original audit record; investigate before correction.');return;}
   if(all.docs.some(d=>overlaps(d.data().report as SteamReport,r)))throw new HttpError(409,'Overlapping product/country sales window already imported.');
   tx.create(ref,{report:r,importedAt:new Date(now).toISOString(),actorUid:actor.uid});tx.set(lock,{updatedAt:new Date(now).toISOString()});
  });return json(200,{id});
 }
 const saved=(await db.doc('steamReports/'+input.id).get()).data();if(!saved)throw new HttpError(404,'Report not found');const r=saved.report as SteamReport;
 const from=new Date(Date.parse(r.start)-72*3600000).toISOString(),to=new Date(Date.parse(r.end)).toISOString();
 const snapshot=await db.collection('steamClicks').where('createdAt','>=',from).where('createdAt','<=',to).limit(5001).get();if(snapshot.size>5000)throw new HttpError(409,'More than 5,000 clicks in this window. No partial reconciliation allowed.');
 const rawClicks=snapshot.docs.map(d=>({...d.data(),id:d.id}) as SteamClick);
 const withdrawn=rawClicks.length?await db.getAll(...[...new Set(rawClicks.map(c=>hash(c.visitorId)))].map(id=>db.doc('steamWithdrawals/'+id))):[];
 const withdrawnIds=new Set(withdrawn.filter(d=>d.exists).map(d=>d.id));
 const clicks=rawClicks.filter(c=>!withdrawnIds.has(hash(c.visitorId)));
 const usedSnap=await db.collection('steamAllocations').where('appId','==',r.appId).limit(5001).get();if(usedSnap.size>5000)throw new HttpError(409,'Allocation history requires paginated reconciliation.');
 const used=new Set(usedSnap.docs.map(d=>String(d.data().visitorProduct))),already=usedSnap.docs.filter(d=>d.data().reportId===input.id).length;
 const prior=usedSnap.docs.filter(d=>d.data().reportId===input.id).map(d=>d.data());
 const remaining={...r,units:Math.max(0,r.units-already),utm:r.utm.map(u=>({...u,purchases:Math.max(0,u.purchases-prior.filter(a=>a.cohort===u.campaign+'\0'+u.content).length)}))};
 const utmSnapshot=await db.collection('steamUtmEvidence').where('appId','==',r.appId).limit(5001).get();if(utmSnapshot.size>5000)throw new HttpError(409,'UTM history requires pagination.');
 const utmEvidence=utmSnapshot.docs.map(d=>({...d.data(),id:d.id,purchases:Math.max(0,Number(d.data().purchases)-Number(d.data().allocated||0))}) as UtmEvidence);
 const available=propose(remaining,clicks,input.threshold,used,utmEvidence);
 if(input.action==='preview')return json(200,{report:r,alreadyAllocated:already,threshold:input.threshold,provisional:now<Date.parse(r.end)+72*3600000,candidates:available.map(c=>({clickId:c.click.id,appId:c.click.appId,country:c.click.country,createdAt:c.click.createdAt,widget:c.click.widget,score:c.score,reasons:c.reasons,utm:c.click.utm,hasFbc:!!c.click.source.fbc,hasFbp:!!c.click.source.fbp}))});
 if(process.env.CONTEXT&&process.env.CONTEXT!=='production')throw new HttpError(403,'Sending is disabled outside production.');
 if(!deploymentControls().AD_CONVERSIONS_ENABLED)throw new HttpError(503,'Ad reporting is disabled.');
 if(now<Date.parse(r.end))throw new HttpError(409,'Review is available after the sales window closes.');
 if(now-Date.parse(r.end)>6*86400000)throw new HttpError(409,'This window is too old to queue reliably within Meta’s event limit.');
 const chosen=available.filter(c=>input.clickIds.includes(c.click.id));if(chosen.length!==new Set(input.clickIds).size)throw new HttpError(409,'Candidates changed or are no longer eligible. Preview again.');
 if(chosen.some(c=>!c.click.source.fbc&&!c.click.source.fbp))throw new HttpError(400,'Sending requires an actual saved Meta click or browser identifier.');
 // Read every dependency before writing. Receipt, browser/product and report
 // counters are locked together, so concurrent approvals cannot overspend units.
 await db.runTransaction(async tx=>{
  const counterRef=db.doc('steamReportAllocations/'+input.id),counter=await tx.get(counterRef);const count=Number(counter.data()?.count||0);
  if(count+chosen.length>r.units)throw new HttpError(409,'These sales have already been allocated. Refresh.');
  const cohortCounts={...(counter.data()?.cohortCounts||{})} as Record<string,number>;
  for(const c of chosen){const key=hash(c.cohort);cohortCounts[key]=(cohortCounts[key]||0)+1;const u=r.utm.find(x=>x.campaign+'\0'+x.content===c.cohort);if(u&&cohortCounts[key]>u.purchases)throw new HttpError(409,'UTM cohort units already allocated. Refresh.');}
  const refs=chosen.map(c=>({c,visitorProduct:hash(c.click.visitorId+'|'+c.click.appId),allocation:db.doc('steamAllocations/'+c.allocationId),claim:db.doc('steamClaims/'+hash(c.click.visitorId+'|'+c.click.appId)),click:db.doc('steamClicks/'+c.click.id)}));
  const reads=await Promise.all(refs.map(async x=>({x,allocation:await tx.get(x.allocation),claim:await tx.get(x.claim),click:await tx.get(x.click)})));
  const evidenceIds=[...new Set(chosen.flatMap(c=>c.utmEvidence?[c.utmEvidence.id]:[]))];
  const evidenceReads=await Promise.all(evidenceIds.map(id=>tx.get(db.doc('steamUtmEvidence/'+id))));
  for(const d of evidenceReads){const increment=chosen.filter(c=>c.utmEvidence?.id===d.id).length;if(!d.exists||Number(d.data()?.allocated||0)+increment>Number(d.data()?.purchases||0))throw new HttpError(409,'UTM purchases already allocated. Refresh.');}
  if(reads.some(x=>x.allocation.exists||x.claim.exists||!x.click.exists||x.click.data()?.consent!==true))throw new HttpError(409,'An allocation already exists or consent data is unavailable. Refresh.');
  for(const d of evidenceReads)tx.update(d.ref,{allocated:Number(d.data()?.allocated||0)+chosen.filter(c=>c.utmEvidence?.id===d.id).length});
  for(const {x}of reads){const payload=conversionPayload(r,x.c,input.eventName),eventId=payload.eventId;const job=db.doc('outbox/'+stableDocumentId('meta_conversion','meta:'+eventId));
   tx.create(x.allocation,{reportId:input.id,clickId:x.c.click.id,visitorProduct:x.visitorProduct,appId:r.appId,cohort:x.c.cohort,eventId,eventName:input.eventName,score:x.c.score,threshold:input.threshold,approvedAt:new Date(now).toISOString(),actorUid:actor.uid,jobId:job.id,modelled:true});
   tx.create(x.claim,{allocationId:x.c.allocationId,createdAt:new Date(now).toISOString()});
   tx.create(job,{id:job.id,kind:'meta_conversion',dedupeKey:'meta:'+eventId,createdAt:new Date(now).toISOString(),notBefore:new Date(now).toISOString(),attemptCount:0,state:'pending',payload});
  }
  tx.set(counterRef,{count:count+chosen.length,cohortCounts});tx.create(db.collection('adminAudit').doc(),{action:'approve_steam_modelled_conversions',actorUid:actor.uid,targetId:input.id,count:chosen.length,eventName:input.eventName,threshold:input.threshold,createdAt:new Date(now).toISOString()});
 });return json(200,{queued:chosen.length,message:'Queued for Meta delivery. Queue acceptance does not mean ad attribution.'});
 }catch(e){return errorResponse(e)}};
export default withLambda(lambdaHandler);
