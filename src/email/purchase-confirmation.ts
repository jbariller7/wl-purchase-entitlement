import {createHash} from 'node:crypto';
import nodemailer from 'nodemailer';
import type Stripe from 'stripe';
import type {EntitlementStore} from '../infrastructure/entitlement-store.js';
import type {OutboxJob} from '../domain/model.js';
import {websiteSessionSchema} from '../providers/stripe/website-session.js';
import {websiteStripeClient} from '../providers/stripe/website-config.js';
import {websiteDesktopRoute} from '../providers/stripe/website-commerce.js';
import {websiteDelivery} from '../legacy/website-delivery.js';
import {renderConfirmation} from './template.js';

// Explicit rollout boundary excludes old webhook replays. Changing it is a
// deliberate backfill, not a side effect of turning on the delivery worker.
export function confirmationEligible(created:number):boolean {
 const start=Date.parse(process.env.ORDER_EMAILS_START_AT??'');
 return Number.isFinite(start) && created*1000>=start;
}
export async function queueCheckoutConfirmation(store:EntitlementStore,session:Stripe.Checkout.Session,event:Stripe.Event){
 if(!session.livemode || session.metadata?.wl_email_owner!=='workspace-v1' || !confirmationEligible(event.created) || !['paid','no_payment_required'].includes(session.payment_status))return;
 await store.enqueue('purchase_confirmation',`checkout:${session.id}`,{sessionId:session.id},new Date());
}
export async function queueInvoiceConfirmation(store:EntitlementStore,invoice:Stripe.Invoice,event:Stripe.Event,subscription:Stripe.Subscription){
 if(!event.livemode || !confirmationEligible(event.created) || invoice.status!=='paid' || invoice.amount_paid<=0 || invoice.billing_reason==='subscription_create' || subscription.metadata.wl_checkout_flow!=='website-session-v1' || subscription.metadata.wl_email_owner!=='workspace-v1')return;
 await store.enqueue('purchase_confirmation',`invoice:${invoice.id}`,{invoiceId:invoice.id,subscriptionId:subscription.id},new Date());
}
const objectId=(value:string|{id:string}|null)=>typeof value==='string'?value:value?.id;
export function confirmationTransport(){
 const pass=process.env.ORDER_EMAIL_SMTP_PASSWORD;
 if(!pass)throw new Error('Order email SMTP password is not configured.');
 return nodemailer.createTransport({host:'smtp-relay.gmail.com',port:587,secure:false,requireTLS:true,
  auth:{user:'jonathan@wonderlang.app',pass},tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},
  connectionTimeout:15000,greetingTimeout:15000,socketTimeout:20000,logger:false,debug:false,
  disableFileAccess:true,disableUrlAccess:true});
}
export async function sendPurchaseConfirmation(job:OutboxJob,store:EntitlementStore):Promise<Record<string,unknown>>{
 const db=store.firestore(),ref=db.collection('orderEmailDeliveries').doc(job.id);
 const previous=await ref.get();
 if(previous.data()?.state==='sent')return {emailState:'sent',deduplicated:true};
 if(['sending','uncertain'].includes(previous.data()?.state))throw new Error('Order email delivery is uncertain; review Workspace email logs before retrying.');
 const stripe=websiteStripeClient();
 const invoiceId=typeof job.payload.invoiceId==='string'?job.payload.invoiceId:undefined;
 const invoice=invoiceId?await stripe.invoices.retrieve(invoiceId,{expand:['payments']}):undefined;
 let sessionId=String(job.payload.sessionId??'');
 if(invoice){
  if(invoice.status!=='paid' || invoice.amount_paid<=0 || !invoice.livemode)return {emailState:'suppressed'};
  const subscriptionId=String(job.payload.subscriptionId??'');
  const sessions=await stripe.checkout.sessions.list({subscription:subscriptionId,limit:1});
  sessionId=sessions.data[0]?.id??'';
 }
 if(!/^cs_[A-Za-z0-9_]+$/.test(sessionId))throw new Error('Order email has no valid checkout reference.');
 const order=(await db.collection('websiteOrders').doc(sessionId).get()).data();
 if(!order)throw new Error('Order email is waiting for its verified website order.');
 const request=websiteSessionSchema.parse(order.request);
 const session=await stripe.checkout.sessions.retrieve(sessionId);
 if(!session.livemode || !['paid','no_payment_required'].includes(session.payment_status))return {emailState:'suppressed'};
 const email=session.customer_details?.email?.trim().toLowerCase();
 if(!email || email!==order.buyerEmail || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))throw new Error('Order email recipient does not match the verified purchase.');
 const paymentIds=invoice?invoice.payments?.data.flatMap(p=>p.payment.payment_intent?[objectId(p.payment.payment_intent)!]:[])??[]:[objectId(session.payment_intent)].filter((id):id is string=>!!id);
 if(invoice && (invoice.payments?.has_more || !paymentIds.length))throw new Error('Invoice payment verification needs review.');
 for(const paymentId of paymentIds){
  const payment=await stripe.paymentIntents.retrieve(paymentId,{expand:['latest_charge']});
  const charge=payment.latest_charge;
  if(charge && typeof charge!=='string' && (charge.refunded || charge.disputed || charge.amount_refunded>0))return {emailState:'suppressed'};
 }
 const route=websiteDesktopRoute(request);
 const keys=route?(await websiteDelivery(db,sessionId,email,route.sheetTab)).map(k=>k.key):[];
 if(route && keys.length<route.quantity)throw new Error('Order email is waiting for the existing key allocator.');
 const content=renderConfirmation({request,email,reference:invoiceId??sessionId,amount:invoice?.amount_paid??session.amount_total??0,currency:invoice?.currency??session.currency??'usd',country:session.customer_details?.address?.country,keys,renewal:!!invoice});
 const transport=confirmationTransport(); // Validate configuration before reserving a send.
 const messageId=`<wl-order-${createHash('sha256').update(job.dedupeKey).digest('hex')}@wonderlang.app>`;
 const reserved=await db.runTransaction(async tx=>{
  const latest=await tx.get(ref);
  if(latest.data()?.state==='sent')return false;
  if(['sending','uncertain'].includes(latest.data()?.state))throw new Error('Order email delivery requires review.');
  tx.set(ref,{state:'sending',sessionId,...(invoiceId?{invoiceId}:{}),locale:content.locale,messageId,startedAt:new Date().toISOString()});
  return true;
 });
 if(!reserved)return {emailState:'sent',deduplicated:true};
 try{
  const result=await transport.sendMail({from:{name:'WonderLang',address:'orders@wonderlang.app'},replyTo:'orders@wonderlang.app',to:{address:email,name:''},messageId,subject:content.subject,text:content.text,html:content.html});
  if(!result.accepted.length)throw Object.assign(new Error('SMTP rejected recipient.'),{responseCode:550});
  await ref.update({state:'sent',sentAt:new Date().toISOString()});
  return {emailState:'sent',locale:content.locale};
 }catch(error){
  // SMTP has no idempotency API. Do not resend after a lost acknowledgement:
  // an operator must first check whether Google accepted the message.
  const e=error as {responseCode?:number;code?:string;command?:string};
  const knownRejected=(e.responseCode??0)>=400 || ['EAUTH','ECONNECTION','EDNS'].includes(e.code??'') || (e.code==='ETIMEDOUT' && ['CONN','EHLO','AUTH'].includes(e.command??''));
  await ref.update({state:knownRejected?'retryable':'uncertain',lastError:knownRejected?'smtp_rejected':'delivery_uncertain',updatedAt:new Date().toISOString()});
  throw new Error(knownRejected?'Order email was rejected by SMTP; queued for retry.':'Order email delivery is uncertain; review Workspace email logs before retrying.');
 }finally{transport.close();}
}
