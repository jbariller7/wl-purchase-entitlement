import type {Firestore} from 'firebase-admin/firestore';
import {confirmationTransport} from './purchase-confirmation.js';
import {renderConfirmation} from './template.js';
import {recordAdminAudit,type AdminActor} from '../admin/audit.js';

export async function orderEmailStatus(db:Firestore){
 const recent=await db.collection('orderEmailDeliveries').orderBy('startedAt','desc').limit(30).get();
 return {enabled:process.env.ORDER_EMAILS_ENABLED==='true',configured:!!process.env.ORDER_EMAIL_SMTP_PASSWORD,startAt:process.env.ORDER_EMAILS_START_AT??null,
  deliveries:recent.docs.map(doc=>{const d=doc.data();return {id:doc.id,state:d.state,locale:d.locale,startedAt:d.startedAt,sentAt:d.sentAt??null,messageId:d.messageId};})};
}
export async function testOrderEmail(db:Firestore,actor:AdminActor){
 // Fixed owner recipient, dummy content only: never an arbitrary mail endpoint.
 const recipient='jonathan@wonderlang.app';
 await recordAdminAudit({db,actor,action:'order_email.test',targetType:'email',targetId:'owner-preview',summary:'Requested a dummy purchase email to the Workspace owner',now:new Date()});
 const message=renderConfirmation({request:{offer:'premium',delivery:'steam',locale:'en',currency:'EUR',requestId:'b6d9ff25-0eab-4f2d-9d9f-1c2d79354f16'},email:recipient,reference:'TEST-ONLY-NO-PURCHASE',amount:0,currency:'eur',keys:['TEST-ONLY-NOT-A-REAL-STEAM-KEY']});
 const transport=confirmationTransport();
 try{
  await transport.verify();
  const sent=await transport.sendMail({from:{name:'WonderLang',address:'orders@wonderlang.app'},to:recipient,replyTo:'orders@wonderlang.app',subject:'TEST ONLY — WonderLang purchase email preview',text:'TEST ONLY. No purchase or charge.\n\n'+message.text,html:'<p>TEST ONLY. No purchase or charge.</p>'+message.html});
  if(!sent.accepted.length)throw new Error('Rejected');
  return {accepted:true,recipient,messageId:sent.messageId};
 }catch{throw new Error('The test email could not be confirmed. Check the SMTP credential, relay rule and Workspace email logs.');}
 finally{transport.close();}
}
