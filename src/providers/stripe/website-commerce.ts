import { createHash } from "node:crypto";
import type Stripe from "stripe";
import type { DecodedIdToken } from "firebase-admin/auth";
import { websiteStripeClient as stripeClient, websiteStripeConfiguration, websitePriceId } from './website-config.js';
import { HttpError, requireVerifiedEmail } from "../../http/auth.js";
import type { EntitlementStore } from "../../infrastructure/entitlement-store.js";
import type { LedgerGrant, LegacyOrder } from "../../domain/model.js";
import { SHEET_TAB_BY_PRODUCT, routePremiumDesktopAccess } from "../../legacy/catalog.js";
import {websiteDelivery} from '../../legacy/website-delivery.js';
import { websiteSessionSchema, websiteSessionParams, assertWebsitePrice, type WebsiteSessionRequest } from "./website-session.js";
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const id=(v:string|{id:string}|null|undefined)=>typeof v==='string'?v:v?.id;
interface Quote {request:WebsiteSessionRequest;priceId:string;claimHash:string;sessionId?:string;createdAt:string;}
interface WebsiteOrder extends Quote {sessionId:string;buyerEmail:string;sourceEventId:string;sourceEventCreated:number;claimedByUid?:string;}
export async function discoverWebsitePurchases(store:EntitlementStore,user:DecodedIdToken){
  const email=requireVerifiedEmail(user);
  const matching=await store.firestore().collection('websiteOrders').where('buyerEmail','==',email).limit(100).get();
  const existingGrants=await store.grantsForUid(user.uid);
  for(const doc of matching.docs){
    const owner=doc.data().claimedByUid;
    if(owner && owner!==user.uid)continue;
    // A claim reserves its owner before writing the grant. Retry an interrupted
    // claim for that same owner instead of leaving a paid customer without access.
    if(owner && existingGrants.some(g=>g.metadata?.stripeCheckoutSessionId===doc.id))continue;
    try{await claimWebsiteOrder(store,user,doc.id)}catch(error){
      // A refunded/disputed order is not eligible. Infrastructure errors must
      // remain visible for retry, rather than silently losing an entitlement.
      if(!(error instanceof HttpError && [403,409].includes(error.status)))throw error;
    }
  }
  const owned=await store.firestore().collection('websiteOrders').where('claimedByUid','==',user.uid).limit(100).get();
  const grants=await store.grantsForUid(user.uid);
  return Promise.all(owned.docs.map(async doc=>{
    const order=doc.data() as WebsiteOrder;
    const grant=grants.find(g=>g.metadata?.stripeCheckoutSessionId===doc.id);
    const allowed=grant && ['active','grace'].includes(grant.state);
    const route=websiteDesktopRoute(order.request);
    const keys=allowed&&route?(await websiteDelivery(store.firestore(),doc.id,order.buyerEmail,route.sheetTab)).map(k=>k.key):[];
    return {sessionId:doc.id,offer:order.request.offer,delivery:order.request.delivery??null,mobilePlatform:grant?.metadata?.primaryMobilePlatform??order.request.mobilePlatform??'later',mobileSelectionPending:Boolean(allowed&&grant?.metadata?.mobileSelectionPending),state:grant?.state??'pending',keys,subscriptionId:grant?.providerSubscriptionId??null};
  }));
}
export async function websiteSubscriptionPortal(store:EntitlementStore,user:DecodedIdToken,subscriptionId:string){
  requireVerifiedEmail(user);
  if(await store.uidForProviderSubscription('stripe',subscriptionId)!==user.uid)throw new HttpError(404,'Subscription not found.');
  const subscription=await stripeClient().subscriptions.retrieve(subscriptionId);
  const customer=id(subscription.customer);if(!customer)throw new HttpError(404,'Billing customer not found.');
  // Guest checkouts use a separate Stripe Customer per purchase. Never open a
  // portal based on an email match: prove ownership of every subscription on
  // the customer, since the portal can expose more than the selected one.
  const subscriptions=await stripeClient().subscriptions.list({customer,status:'all',limit:100});
  if(subscriptions.has_more)throw new HttpError(409,'Contact support to manage this billing account.');
  for(const entry of subscriptions.data)if(await store.uidForProviderSubscription('stripe',entry.id)!==user.uid)throw new HttpError(403,'Billing account ownership could not be verified.');
  const stripe=stripeClient();
  const configurations=await stripe.billingPortal.configurations.list({active:true,limit:100});
  let configuration=configurations.data.find(c=>c.metadata?.wl_purpose==='website-subscription-cancellation-v1');
  if(!configuration)configuration=await stripe.billingPortal.configurations.create({
    business_profile:{headline:'WonderLang'},
    features:{subscription_cancel:{enabled:true,mode:'at_period_end'},payment_method_update:{enabled:true},invoice_history:{enabled:true}},
    metadata:{wl_purpose:'website-subscription-cancellation-v1'}
  },{idempotencyKey:'wl-website-subscription-cancellation-config-v1'});
  return (await stripe.billingPortal.sessions.create({customer,configuration:configuration.id,return_url:websiteStripeConfiguration().origin+'/account/'})).url;
}
export async function selectWebsiteMobilePlatform(store:EntitlementStore,user:DecodedIdToken,sessionId:string,platform:'android'|'ios'){
 requireVerifiedEmail(user);
 if(!/^cs_[A-Za-z0-9_]+$/.test(sessionId)||!['android','ios'].includes(platform))throw new HttpError(400,'Invalid mobile selection.');
 const db=store.firestore(),orderRef=db.collection('websiteOrders').doc(sessionId);
 const selected=await db.runTransaction(async tx=>{
  const order=await tx.get(orderRef);
  if(!order.exists||order.data()?.claimedByUid!==user.uid)throw new HttpError(404,'Purchase not found.');
  if(order.data()?.request.offer!=='premium')throw new HttpError(403,'Premium Lifetime is required.');
  const grants=await tx.get(db.collection('grants').where('uid','==',user.uid));
  const grant=grants.docs.find(g=>g.data().metadata?.stripeCheckoutSessionId===sessionId&&g.data().product==='premium_lifetime_pass');
  if(!grant||!['active','grace'].includes(grant.data().state))throw new HttpError(409,'This Premium purchase is not active.');
  const metadata=grant.data().metadata??{};
  if(metadata.primaryMobilePlatform===platform&&!metadata.mobileSelectionPending)return platform;
  if(metadata.mobileSelectionPending!==true)throw new HttpError(409,'The first mobile platform has already been selected. Contact support to change it.');
  const now=new Date().toISOString();
  tx.update(grant.ref,{metadata:{...metadata,primaryMobilePlatform:platform,mobileSelectionPending:false},updatedAt:now});
  tx.update(orderRef,{selectedMobilePlatform:platform,mobilePlatformSelectedAt:now});
  tx.set(db.collection('websiteMobileSelections').doc(sessionId),{uid:user.uid,sessionId,platform,selectedAt:now});
  return platform;
 });
 await store.recomputeEntitlements(user.uid,new Date());
 return {mobilePlatform:selected};
}
export async function startWebsiteCheckout(store:EntitlementStore,request:WebsiteSessionRequest,claimSecret:string){
  if(!/^[A-Za-z0-9_-]{43}$/.test(claimSecret))throw new HttpError(400,'Invalid purchase recovery secret.');
  const priceId=websitePriceId(request.offer);
  if(!priceId)throw new HttpError(503,'This website offer is not configured.');
  const stripe=stripeClient(),origin=websiteStripeConfiguration().origin;
  const price=await stripe.prices.retrieve(priceId,{expand:['currency_options']});
  assertWebsitePrice(price,request,true);
  const quote:Quote={request,priceId,claimHash:digest(claimSecret),createdAt:new Date().toISOString()};
  const ref=store.firestore().collection('websiteCheckoutRequests').doc(request.requestId);
  const previousSession=await store.firestore().runTransaction(async tx=>{const previous=await tx.get(ref);if(previous.exists){const p=previous.data() as Quote;if(p.claimHash!==quote.claimHash||JSON.stringify(p.request)!==JSON.stringify(request)||p.priceId!==priceId)throw new HttpError(409,'Checkout request cannot be reused with different options.');return p.sessionId;}tx.create(ref,quote);return undefined;});
  if(previousSession){
    const previous=await stripe.checkout.sessions.retrieve(previousSession);
    if(previous.status==='complete')return {completed:true,sessionId:previous.id};
    if(previous.status==='open'&&previous.url)return {url:previous.url,sessionId:previous.id};
    throw new HttpError(409,'This checkout has expired. Please select your offer again.');
  }
  const parameters=websiteSessionParams(request,priceId,origin);
  parameters.metadata={...parameters.metadata,wl_request_id:request.requestId};
  if(parameters.subscription_data)parameters.subscription_data.metadata={...parameters.subscription_data.metadata,wl_request_id:request.requestId};
  const session=await stripe.checkout.sessions.create(parameters,{idempotencyKey:`website-session-v1:${request.requestId}`});
  if(!session.url)throw new Error('Stripe checkout URL is missing.');
  await ref.set({sessionId:session.id},{merge:true});
  return {url:session.url,sessionId:session.id};
}
export function websiteDesktopRoute(r:WebsiteSessionRequest){
  if(r.offer.startsWith('mobile_'))return undefined;
  if(!r.delivery)throw new Error('Missing desktop delivery.');
  if(r.offer!=='single'||r.delivery==='direct')return routePremiumDesktopAccess(r.delivery);
  const names:Record<string,string>={french:'French',spanish:'Spanish',german:'German',italian:'Italian',portuguese:'Portuguese',korean:'Korean',japanese:'Japanese',mandarin:'Mandarin',english:'English'};
  const productCode=names[r.learningLanguage??''];if(!productCode)throw new Error('Unknown learning language.');
  return {productCode,playMode:'STEAM' as const,sheetTab:SHEET_TAB_BY_PRODUCT[productCode]!,quantity:1};
}
export async function recordWebsitePayment(store:EntitlementStore,session:Stripe.Checkout.Session,event:Stripe.Event){
  if(!session.livemode)throw new Error('Website checkout payment must be live.');
  if(session.payment_status!=='paid'&&session.payment_status!=='no_payment_required')return undefined;
  const requestId=session.metadata?.wl_request_id;
  if(!requestId||!/^[-a-f0-9]{36}$/i.test(requestId))throw new Error('Website payment has no registered request.');
  const quoteSnap=await store.firestore().collection('websiteCheckoutRequests').doc(requestId).get();
  if(!quoteSnap.exists)throw new Error('Website payment request was not created by this backend.');
  const quote=quoteSnap.data() as Quote;
  websiteSessionSchema.parse(quote.request);
  if(quote.sessionId&&quote.sessionId!==session.id)throw new Error('Website checkout session does not match its request.');
  const items=await stripeClient().checkout.sessions.listLineItems(session.id,{limit:2});
  if(items.data.length!==1||items.data[0]?.price?.id!==quote.priceId||items.data[0]?.quantity!==1)throw new Error('Website payment items do not match its registered price.');
  const buyerEmail=session.customer_details?.email?.trim().toLowerCase();
  if(!buyerEmail)throw new Error('Website purchase email is missing.');
  const ref=store.firestore().collection('websiteOrders').doc(session.id);
  await store.firestore().runTransaction(async tx=>{const previous=await tx.get(ref);if(!previous.exists)tx.create(ref,{...quote,sessionId:session.id,buyerEmail,sourceEventId:event.id,sourceEventCreated:event.created});});
  const route=websiteDesktopRoute(quote.request);
  if(route){const transactionId=id(session.payment_intent);const order:LegacyOrder={id:session.id,stripeCheckoutSessionId:session.id,...(transactionId?{stripePaymentIntentId:transactionId}:{}),buyerEmail,productCode:route.productCode,playMode:route.playMode,quantity:1,amountTotal:session.amount_total??0,currency:session.currency?.toUpperCase()??'USD',paidAt:new Date(event.created*1000).toISOString()};await store.saveLegacyOrder(order);}
  return quote.request;
}
export async function claimWebsiteOrder(store:EntitlementStore,user:DecodedIdToken,sessionId:string,claimSecret?:string){
  const email=requireVerifiedEmail(user);
  if(!/^cs_(test_|live_)?[A-Za-z0-9_]+$/.test(sessionId))throw new HttpError(400,'Invalid checkout reference.');
  const ref=store.firestore().collection('websiteOrders').doc(sessionId);
  let snap=await ref.get();
  if(!snap.exists){
    // The buyer may return before Stripe delivers its webhook. Verify directly
    // with Stripe, then use the same idempotent registered-order path.
    const paid=await stripeClient().checkout.sessions.retrieve(sessionId);
    if(paid.metadata?.wl_checkout_flow!=='website-session-v1')throw new HttpError(404,'Website purchase not found.');
    await recordWebsitePayment(store,paid,{id:`verified-return:${sessionId}`,created:paid.created} as Stripe.Event);
    snap=await ref.get();
    if(!snap.exists)throw new HttpError(409,'Payment confirmation is pending. Please try again shortly.');
  }
  const order=snap.data() as WebsiteOrder;
  if(order.buyerEmail!==email&&(!claimSecret||digest(claimSecret)!==order.claimHash))throw new HttpError(403,'Sign in with your purchase email or use your private purchase activation link.');
  const session=await stripeClient().checkout.sessions.retrieve(sessionId,{expand:['payment_intent.latest_charge','subscription']});
  if(session.payment_status!=='paid'&&session.payment_status!=='no_payment_required')throw new HttpError(403,'This checkout has not been paid.');
  const pi=typeof session.payment_intent==='object'?session.payment_intent:null;
  const charge=pi&&typeof pi.latest_charge==='object'?pi.latest_charge:null;
  if(charge&&(charge.refunded||charge.disputed))throw new HttpError(403,'This payment is refunded or disputed.');
  const request=order.request,subscription=typeof session.subscription==='object'?session.subscription:null;
  const transactionId=request.offer==='mobile_monthly'?subscription?.id:id(session.payment_intent)??session.id;
  if(!transactionId)throw new Error('Purchase transaction is missing.');
  // Reserve the order once. A failed later write can retry only for this same UID.
  await store.firestore().runTransaction(async tx=>{const current=await tx.get(ref);const claimed=current.data()?.claimedByUid;if(claimed&&claimed!==user.uid)throw new HttpError(409,'This purchase is already attached to another account.');tx.update(ref,{claimedByUid:user.uid,claimedAt:new Date().toISOString()});});
  const product:LedgerGrant['product']=request.offer==='premium'?'premium_lifetime_pass':request.offer==='mobile_monthly'?'mobile_full_monthly':request.offer==='mobile_permanent'?'mobile_polyglot_permanent':request.offer==='single'?'desktop_language':'desktop_polyglot';
  const periodEnd=subscription?Math.max(...subscription.items.data.map(x=>x.current_period_end)):undefined;
  const state:LedgerGrant['state']=subscription&&!['active','trialing'].includes(subscription.status)?'expired':'active';
  const route=websiteDesktopRoute(request);
  // Do not let the pre-split legacy fallback unlock both mobile platforms.
  const metadata:NonNullable<LedgerGrant['metadata']>={websiteCheckout:true,stripeCheckoutSessionId:session.id,...(route?{productCode:route.productCode}:{}),...(request.learningLanguage?{learningLanguage:request.learningLanguage}:{})};
  if(subscription)Object.assign(metadata,{stripeStatus:subscription.status,cancelAtPeriodEnd:subscription.cancel_at_period_end,...(subscription.trial_end?{trialEndsAt:new Date(subscription.trial_end*1000).toISOString()}: {})});
  if(request.mobilePlatform&&request.mobilePlatform!=='later')metadata[request.offer==='premium'?'primaryMobilePlatform':'mobilePlatform']=request.mobilePlatform;
  else if(request.offer==='premium')metadata.mobileSelectionPending=true;
  await store.upsertGrant({id:'',uid:user.uid,provider:'stripe',providerTransactionId:transactionId,...(id(session.customer)?{providerCustomerId:id(session.customer)!}:{}),...(subscription?{providerSubscriptionId:subscription.id}:{}),product,state,startsAt:new Date(order.sourceEventCreated*1000).toISOString(),...(periodEnd?{currentPeriodEndsAt:new Date(periodEnd*1000).toISOString(),endsAt:new Date(periodEnd*1000).toISOString()}:{}),metadata}, {id:order.sourceEventId,created:order.sourceEventCreated});
  if(route)await store.firestore().collection('legacyOrders').doc(sessionId).set({firebaseUid:user.uid},{merge:true});
  return {claimed:true,offer:request.offer};
}
