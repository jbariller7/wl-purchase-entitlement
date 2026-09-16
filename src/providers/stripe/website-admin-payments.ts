import type {Firestore} from 'firebase-admin/firestore';
import type Stripe from 'stripe';
import {websiteStripeClient} from './website-config.js';
import {HttpError} from '../../http/auth.js';
const id=(value:string|{id:string}|null|undefined)=>typeof value==='string'?value:value?.id;

// Only follow registered orders belonging to this UID, never email matches.
export async function websitePaymentsForUid(db:Firestore,uid:string):Promise<Stripe.PaymentIntent[]>{
 const orders=await db.collection('websiteOrders').where('claimedByUid','==',uid).get();
 if(orders.empty)return [];
 const stripe=websiteStripeClient(),ids=new Set<string>();
 for(const order of orders.docs){
  const session=await stripe.checkout.sessions.retrieve(order.id);
  if(!session.livemode||session.metadata?.wl_checkout_flow!=='website-session-v1')throw new HttpError(409,'Website order does not match its live Stripe checkout.');
  const payment=id(session.payment_intent);if(payment)ids.add(payment);
  const subscription=id(session.subscription);
  if(subscription){
   for await(const invoice of stripe.invoices.list({subscription,limit:100})){
    if(!invoice.id)continue;
    for await(const entry of stripe.invoicePayments.list({invoice:invoice.id,limit:100})){
     const pi=id(entry.payment.payment_intent);if(pi)ids.add(pi);
    }
   }
  }
 }
 return Promise.all([...ids].map(async paymentId=>{
  const payment=await stripe.paymentIntents.retrieve(paymentId,{expand:['latest_charge']});
  if(!payment.livemode)throw new HttpError(409,'Expected a live website payment.');
  return payment;
 }));
}
export async function ownedWebsitePayment(db:Firestore,uid:string,paymentId:string){
 const payment=(await websitePaymentsForUid(db,uid)).find(p=>p.id===paymentId);
 if(!payment)throw new HttpError(403,'This website payment does not belong to the selected WonderLang account.');
 return payment;
}
