import {describe,it,expect,vi} from 'vitest';
import type {Firestore} from 'firebase-admin/firestore';
import {contactSchema,saveContact,deliverContact,contactEnvelope} from '../src/contact/service.js';
const input={id:'72debf8d-6eaf-4584-a35a-254fa6344e1d',name:'Website test',email:'test@example.com',topic:'general' as const,message:'A test message, without a real customer.',locale:'fr' as const};
function memory(){
 const docs=new Map<string,any>();let queue=Promise.resolve();
 const db={collection:(name:string)=>({doc:(id:string)=>({key:name+'/'+id})}),runTransaction:(fn:any)=>{
  const result=queue.then(()=>fn({get:async(ref:any)=>({exists:docs.has(ref.key),data:()=>docs.get(ref.key)}),create:(ref:any,data:any)=>{if(docs.has(ref.key))throw Error('exists');docs.set(ref.key,data)},update:(ref:any,data:any)=>docs.set(ref.key,{...docs.get(ref.key),...data})}));queue=result.catch(()=>{});return result;
 }}as unknown as Firestore;
 return {db,docs,row:()=>docs.get('contactMessages/'+input.id)};
}
describe('contact inbox and delivery',()=>{
 it('validates a localized message and normalizes the reply email',()=>expect(contactSchema.parse({...input,email:'TEST@example.com'}).email).toBe('test@example.com'));
 it.each([{name:'Bad\r\nBcc: other@example.com'},{email:'x@example.com\nBcc:y@example.com'},{website:'bot-filled'},{message:'tiny'},{message:'x'.repeat(8001)},{recipient:'someone-else@example.com'}])('rejects invalid or injected data %j',change=>expect(contactSchema.safeParse({...input,...change}).success).toBe(false));
 it('saves first, deduplicates a retry, and rejects changed data using the same ID',async()=>{
  const m=memory();await saveContact(m.db,input);await saveContact(m.db,input);expect(m.docs.size).toBe(1);expect(m.row().emailState).toBe('queued');await expect(saveContact(m.db,{...input,message:'Changed after submission'})).rejects.toThrow('already used');
 });
 it('only sends to the fixed support destination with a safe reply-to',()=>{
  const message=contactEnvelope(input);expect(message.to).toBe('contact@wonderlang.net');expect(message.replyTo.address).toBe(input.email);expect(message.from.address).toBe('orders@wonderlang.app');expect(message.messageId).toContain(input.id);expect(message.text).toContain(input.message);
 });
 it('leases concurrent sends and never resends a confirmed notification',async()=>{
  const m=memory();await saveContact(m.db,input);const send=vi.fn(async()=>{});
  await Promise.all([deliverContact(m.db,input.id,send),deliverContact(m.db,input.id,send)]);await deliverContact(m.db,input.id,send);
  expect(send).toHaveBeenCalledTimes(1);expect(m.row().emailState).toBe('sent');expect(m.row().nextAttemptAt).toBeNull();
 });
 it('keeps the full message and schedules a retry after an email error',async()=>{
  const m=memory();await saveContact(m.db,input);await deliverContact(m.db,input.id,async()=>{throw Error('secret SMTP response')});
  expect(m.row().emailState).toBe('queued');expect(m.row().message).toBe(input.message);expect(Date.parse(m.row().nextAttemptAt)).toBeGreaterThan(Date.now());expect(m.row().lastError).not.toContain('secret');
 });
 it('stops after six attempts, keeping the message available to admin',async()=>{
  const m=memory();await saveContact(m.db,input);Object.assign(m.row(),{attempts:5});await deliverContact(m.db,input.id,async()=>{throw Error('failure')});expect(m.row().emailState).toBe('failed');expect(m.row().nextAttemptAt).toBeNull();expect(m.row().message).toBe(input.message);
 });
});
