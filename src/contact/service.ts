import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Firestore} from 'firebase-admin/firestore';
import {HttpError} from '../http/auth.js';
import {confirmationTransport} from '../email/transport.js';
export const contactSchema=z.object({
 id:z.string().uuid(),name:z.string().trim().min(1).max(120).regex(/^[^\r\n\x00]+$/),
 email:z.string().trim().email().max(254).transform(v=>v.toLowerCase()),
 topic:z.enum(['general','order','technical','education_press']),
 message:z.string().trim().min(10).max(8000),locale:z.enum(['en','fr','es']),
 website:z.literal('').optional()
}).strict();
export type Contact=z.infer<typeof contactSchema>;
export async function saveContact(db:Firestore,input:Contact){
 const {website:_,...value}=input,ref=db.collection('contactMessages').doc(value.id);
 const fingerprint=createHash('sha256').update(JSON.stringify(value)).digest('hex');
 await db.runTransaction(async tx=>{
  const old=await tx.get(ref);
  if(old.exists){if(old.data()?.fingerprint!==fingerprint)throw new HttpError(409,'Submission reference already used.');return}
  const now=new Date().toISOString();
  tx.create(ref,{...value,fingerprint,createdAt:now,status:'new',emailState:'queued',attempts:0,nextAttemptAt:now});
 });
 return {accepted:true,id:value.id};
}
export function contactEnvelope(data:Contact){
 return {from:{name:'WonderLang contact form',address:'orders@wonderlang.app'},
  to:'contact@wonderlang.net',replyTo:{name:data.name,address:data.email},
  messageId:`<wl-contact-${data.id}@wonderlang.app>`,
  subject:`[WonderLang contact] ${data.topic} — ${data.name}`,
  text:`New website contact\nReference: ${data.id}\nName: ${data.name}\nEmail: ${data.email}\nLanguage: ${data.locale}\nTopic: ${data.topic}\n\n${data.message}\n\nView in https://wonderlang.app/admin/ → Contacts.\nReply to this email to answer the visitor.`};
}
export async function deliverContact(db:Firestore,id:string,send=async(data:Contact)=>{
 const transport=confirmationTransport();
 try{const result=await transport.sendMail(contactEnvelope(data));if(!result.accepted.length)throw new Error('smtp_rejected')}
 finally{transport.close()}
}){
 const ref=db.collection('contactMessages').doc(id),lease=randomUUID(),now=Date.now();
 const data=await db.runTransaction(async tx=>{
  const s=await tx.get(ref),d=s.data();
  if(!d||d.emailState==='sent'||!d.nextAttemptAt||Date.parse(d.nextAttemptAt)>now)return null;
  const attempt=(d.attempts||0)+1;
  tx.update(ref,{emailState:'sending',attempts:attempt,lease,nextAttemptAt:new Date(now+300000).toISOString()});
  return {value:d,attempts:attempt};
 });
 if(!data)return false;
 let ok=false;try{const d=data.value;await send(contactSchema.parse({id,name:d.name,email:d.email,topic:d.topic,message:d.message,locale:d.locale}));ok=true}catch{}
 await db.runTransaction(async tx=>{
  const latest=(await tx.get(ref)).data();if(latest?.lease!==lease)return;
  const failed=data.attempts>=6;
  tx.update(ref,ok?{emailState:'sent',emailSentAt:new Date().toISOString(),nextAttemptAt:null,lastError:null}:
   {emailState:failed?'failed':'queued',lastError:'Email forwarding failed; the message remains saved in Contacts.',nextAttemptAt:failed?null:new Date(Date.now()+Math.min(3600000,60000*2**data.attempts)).toISOString()});
 });
 return ok;
}
export async function listContacts(db:Firestore,cursor?:string){
 let query=db.collection('contactMessages').orderBy('createdAt','desc').limit(51);
 if(cursor){if(!z.string().uuid().safeParse(cursor).success)throw new HttpError(400,'Invalid cursor');const doc=await db.collection('contactMessages').doc(cursor).get();if(!doc.exists)throw new HttpError(400,'Invalid cursor');query=query.startAfter(doc)}
 const rows=(await query.get()).docs;
 return {messages:rows.slice(0,50).map(d=>{const v=d.data();return {id:d.id,name:v.name,email:v.email,topic:v.topic,message:v.message,locale:v.locale,createdAt:v.createdAt,status:v.status,emailState:v.emailState,emailSentAt:v.emailSentAt??null,attempts:v.attempts,lastError:v.lastError??null}}),nextCursor:rows.length>50?rows[49]!.id:null};
}
