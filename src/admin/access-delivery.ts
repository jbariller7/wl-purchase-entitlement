import {createHash} from 'node:crypto';
import type {EntitlementStore} from '../infrastructure/entitlement-store.js';
import type {OutboxJob} from '../domain/model.js';
import {allocateSheetKey} from '../legacy/sheet-allocation.js';
import {renderConfirmation} from '../email/template.js';
import {confirmationTransport} from '../email/transport.js';
import {HttpError} from '../http/auth.js';
import {safeErrorMessage} from '../infrastructure/safe-error.js';

export interface AccessDeliveryInput {requestId:string;uid:string;email:string;product:string;mobilePlatform:'android'|'ios';delivery:'none'|'steam'|'direct';sendEmail:boolean;locale:string;actorUid:string}
export async function queueAccessDelivery(store:EntitlementStore,input:AccessDeliveryInput){
 const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
 const ref=store.firestore().collection('adminAccessDeliveries').doc(input.requestId);
 await store.firestore().runTransaction(async tx=>{
  const existing=await tx.get(ref);
  if(existing.exists){if(existing.data()?.fingerprint!==fingerprint)throw new HttpError(409,'This request was already submitted with different delivery options. Start a new request.');return;}
  tx.create(ref,{...input,fingerprint,state:'queued',emailState:input.sendEmail?'queued':'not_requested',deliveryState:input.delivery==='none'?'not_required':'queued',createdAt:new Date().toISOString()});
 });
 await store.enqueue('manual_access_delivery',input.requestId,{requestId:input.requestId},new Date());
 return input.requestId;
}
export async function accessDeliveryStatus(store:EntitlementStore,id:string){
 const d=(await store.firestore().collection('adminAccessDeliveries').doc(id).get()).data();
 if(!d)throw new HttpError(404,'Delivery request not found.');
 return {id,email:d.email,uid:d.uid,state:d.state,emailState:d.emailState,deliveryState:d.deliveryState,delivery:d.delivery,key:d.key??null,sentAt:d.sentAt??null,messageId:d.messageId??null,error:d.error??null};
}
export async function sendAccessDelivery(job:OutboxJob,store:EntitlementStore):Promise<Record<string,unknown>>{
 const id=String(job.payload.requestId),ref=store.firestore().collection('adminAccessDeliveries').doc(id);
 let d=(await ref.get()).data();
 if(!d)throw new Error('Manual access delivery is missing.');
 if(d.state==='complete')return {state:'complete',deduplicated:true};
 if(['sending','uncertain'].includes(d.emailState))throw new Error('Email delivery is uncertain. Review Workspace email logs before retrying.');
 try{
  await ref.update({state:'processing',error:null});
  if(d.delivery!=='none'&&!d.key){
   const assigned=await allocateSheetKey(store.firestore(),{orderId:`manual-access-${id}`,email:d.email,sheetTab:d.delivery==='steam'?'Polyglot Steam':'Polyglot Itch'});
   await ref.update({key:assigned.key,sheetTab:assigned.sheetTab,rowNumber:assigned.rowNumber,deliveryState:'assigned'});
   await store.firestore().collection('legacyFulfillments').doc(`manual-access-${id}`).set({orderId:`manual-access-${id}`,keys:[assigned],allocationAuthority:'google-sheets',createdAt:new Date().toISOString()});
   d={...d,key:assigned.key};
  }
  if(d.sendEmail&&d.emailState!=='sent'){
   const premium=d.product==='premium_lifetime_pass';
   const content=renderConfirmation({request:{offer:premium?'premium':'mobile_permanent',...(premium?{delivery:d.delivery as 'steam'|'direct'}:{mobilePlatform:d.mobilePlatform as 'android'|'ios'}),locale:d.locale,currency:'EUR',requestId:id},email:d.email,reference:`manual-access-${id}`,amount:0,omitAmount:true,currency:'eur',keys:d.key?[d.key]:[]});
   const transport=confirmationTransport(),messageId=`<wl-manual-access-${id}@wonderlang.app>`;
   try{
    await transport.verify();
    await ref.update({emailState:'sending',messageId});
    const result=await transport.sendMail({from:{name:'WonderLang',address:'orders@wonderlang.app'},to:d.email,replyTo:'orders@wonderlang.app',messageId,subject:content.subject,text:content.text,html:content.html});
    if(!result.accepted.length)throw Object.assign(new Error('SMTP rejected recipient.'),{responseCode:550});
    await ref.update({emailState:'sent',sentAt:new Date().toISOString()});
   }catch(error){
    const e=error as {responseCode?:number;code?:string};
    const current=(await ref.get()).data();
    const definiteRejection=(e.responseCode??0)>=400||['EAUTH','ECONNECTION','EDNS'].includes(e.code??'');
    await ref.update({emailState:current?.emailState==='sending'&&!definiteRejection?'uncertain':'failed'});
    throw new Error('Confirmation email was not confirmed sent. Check the delivery status before retrying.');
   }finally{transport.close();}
  }
  await ref.update({state:'complete',error:null,completedAt:new Date().toISOString()});
  return {state:'complete'};
 }catch(error){await ref.update({state:'failed',error:safeErrorMessage(error,'Delivery failed; access remains granted.')});throw error;}
}
