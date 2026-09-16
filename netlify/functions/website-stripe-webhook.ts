import {withLambda,type LambdaHandler} from '@netlify/aws-lambda-compat';
import type Stripe from 'stripe';
import {websiteStripeClient} from '../../src/providers/stripe/website-config.js';
import {withStripeClient} from '../../src/providers/stripe/client.js';
import {processStripeEvent} from '../../src/providers/stripe/event-processor.js';
import {EntitlementStore} from '../../src/infrastructure/entitlement-store.js';
import {firestore} from '../../src/infrastructure/firebase.js';
import {sha256} from '../../src/infrastructure/ids.js';
import {safeErrorMessage} from '../../src/infrastructure/safe-error.js';

const objectId=(value:any):string|undefined=>typeof value==='string'?value:value?.id;
const website=(value:any)=>value?.metadata?.wl_checkout_flow==='website-session-v1';
export async function isWebsiteStripeEvent(event:Stripe.Event,stripe:Stripe):Promise<boolean>{
 const value=event.data.object as any;
 if(event.type.startsWith('checkout.session.')||event.type.startsWith('customer.subscription.'))return website(value);
 if(event.type.startsWith('invoice.')){
  const subId=objectId(value.parent?.subscription_details?.subscription??value.subscription);
  return subId?website(await stripe.subscriptions.retrieve(subId)):false;
 }
 if(event.type==='charge.refunded'||event.type==='charge.dispute.created'){
  const charge=event.type==='charge.refunded'?value:typeof value.charge==='string'?await stripe.charges.retrieve(value.charge):value.charge;
  const paymentId=objectId(charge?.payment_intent);
  return paymentId?website(await stripe.paymentIntents.retrieve(paymentId)):false;
 }
 return false;
}
export const lambdaHandler:LambdaHandler=async request=>{
 if(request.httpMethod!=='POST')return {statusCode:405,body:'Method not allowed'};
 const secret=process.env.STRIPE_WEBSITE_WEBHOOK_SECRET;
 if(!secret)return {statusCode:503,body:'Website webhook signing secret is not configured'};
 const signature=request.headers['stripe-signature'];
 if(!signature||!request.body)return {statusCode:400,body:'Missing signature or body'};
 const raw=request.isBase64Encoded?Buffer.from(request.body,'base64').toString('utf8'):request.body;
 const stripe=websiteStripeClient();let event:Stripe.Event;
 try{event=stripe.webhooks.constructEvent(raw,signature,secret);}catch{return {statusCode:400,body:'Invalid signature'};}
 if(!event.livemode)return {statusCode:400,body:'Website checkout expects live events'};
 const store=new EntitlementStore(firestore());
 try{
  if(!await isWebsiteStripeEvent(event,stripe))return {statusCode:200,body:'Not a website checkout event'};
  const decision=await store.beginProviderEvent({provider:'stripe',providerEventId:event.id,eventType:event.type,eventCreated:event.created,payloadSha256:sha256(raw),now:new Date()});
  if(decision==='duplicate')return {statusCode:200,body:'Duplicate accepted'};
  await withStripeClient(stripe,()=>processStripeEvent(store,event));
  await store.completeProviderEvent('stripe',event.id,new Date());
  return {statusCode:200,body:'Processed'};
 }catch(error){
  await store.failProviderEvent('stripe',event.id,error,new Date()).catch(()=>undefined);
  console.error('Website payment processing failed',{eventId:event.id,error:safeErrorMessage(error)});
  return {statusCode:500,body:'Processing failed; retry'};
 }
};
export default withLambda(lambdaHandler);
