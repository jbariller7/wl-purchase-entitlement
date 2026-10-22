import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import type Stripe from 'stripe';
import type {Firestore} from 'firebase-admin/firestore';
import {HttpError} from '../http/auth.js';
import {VIP_FLOW,VIP_TERMS,vipTier,vipTiers} from './catalog.js';

const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const objectId=(v:any):string|undefined=>typeof v==='string'?v:v?.id;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isVipObject=(v:any)=>v?.metadata?.wl_checkout_flow===VIP_FLOW;
const money=(n:number)=>(n/100).toFixed(2);

export async function createVipCheckout(db:Firestore,stripe:Stripe,tierId:string,origin:string){
 const tier=vipTier(tierId);if(!tier)throw new HttpError(400,'Choose an available VIP reward.');
 const attemptId=randomUUID(),token=randomBytes(32).toString('hex');
 const ref=db.collection('beyondVipCheckoutAttempts').doc(attemptId);
 const now=new Date().toISOString();
 // Persist before exposing a payment page. A failed database write prevents checkout.
 await ref.create({tierId:tier.id,tierName:tier.name,normalEurCents:tier.normal,vipEurCents:tier.vip,
  tokenHash:hash(token),termsVersion:VIP_TERMS,createdAt:now,paymentState:'open',nextCheckAt:new Date(Date.now()+600000).toISOString()});
 const metadata={wl_checkout_flow:VIP_FLOW,wl_vip_tier:tier.id,wl_vip_attempt:attemptId,wl_terms:VIP_TERMS};
 const session=await stripe.checkout.sessions.create({mode:'payment',locale:'auto',
  line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:100,tax_behavior:'inclusive',product_data:{
   name:'WonderLang Beyond VIP reservation: '+tier.name,
   description:`US$1 reservation only. Later VIP Kickstarter pledge: EUR ${money(tier.vip)} (normal EUR ${money(tier.normal)}). Separate fee, refundable anytime: jonathan@wonderlang.app.`,
   metadata:{wl_checkout_flow:VIP_FLOW,wl_vip_tier:tier.id}
  }}}],
  adaptive_pricing:{enabled:true},automatic_tax:{enabled:true},allow_promotion_codes:false,
  consent_collection:{terms_of_service:'required'},
  custom_text:{submit:{message:'You are paying only the separate, refundable US$1 VIP reservation fee (or the local equivalent shown). The discounted Kickstarter pledge is paid separately at launch; it is never charged automatically.'},
   terms_of_service_acceptance:{message:`I agree to the [VIP reservation terms](${origin}/beyondmockup/reservation-terms.html), including the separate fee and refund policy.`}},
  payment_intent_data:{metadata,description:'Beyond VIP reservation: '+tier.name},metadata,
  success_url:origin+'/beyondmockup/reserved.html?session_id={CHECKOUT_SESSION_ID}&token='+token,
  cancel_url:origin+'/beyondmockup/#reward-'+tier.id,
  expires_at:Math.floor(Date.now()/1000)+1800
 },{idempotencyKey:'beyond-vip-'+attemptId});
 if(!session.url||new URL(session.url).hostname!=='checkout.stripe.com')throw new Error('Unexpected Stripe checkout URL');
 await ref.update({sessionId:session.id});
 return session.url;
}

export async function isVipStripeEvent(event:Stripe.Event,stripe:Stripe){
 const value=event.data.object as any;
 if(event.type.startsWith('checkout.session.'))return isVipObject(value);
 if(event.type==='charge.refunded'||event.type.startsWith('charge.dispute.')){
  const charge=event.type==='charge.refunded'?value:typeof value.charge==='string'?await stripe.charges.retrieve(value.charge):value.charge;
  const pi=objectId(charge?.payment_intent);
  return pi?isVipObject(await stripe.paymentIntents.retrieve(pi)):false;
 }
 return false;
}

// Re-read authoritative Stripe state, rather than trusting a return URL or the
// ordering of webhook events. A refund received before completion stays refunded.
export async function syncVipSession(db:Firestore,stripe:Stripe,sessionId:string,source:string){
 const session=await stripe.checkout.sessions.retrieve(sessionId,{expand:['line_items.data.price.product','payment_intent.latest_charge']});
 if(!isVipObject(session)||!session.livemode)throw new HttpError(404,'Reservation not found.');
 const meta=session.metadata!,attemptId=meta.wl_vip_attempt,tier=vipTier(meta.wl_vip_tier);
 if(!attemptId||!uuid.test(attemptId)||!tier||meta.wl_terms!==VIP_TERMS)throw new Error('Invalid VIP checkout metadata');
 const attemptRef=db.collection('beyondVipCheckoutAttempts').doc(attemptId);
 const attempt=(await attemptRef.get()).data();
 if(!attempt||attempt.sessionId!==session.id||attempt.tierId!==tier.id||attempt.termsVersion!==VIP_TERMS)throw new Error('VIP attempt does not match payment');
 const line=session.line_items?.data;
 const price=line?.[0]?.price,product=price?.product as Stripe.Product|undefined;
 const baseCurrency=session.currency_conversion?.source_currency??session.currency;
 const baseAmount=session.currency_conversion?.amount_total??session.amount_total;
 if(session.mode!=='payment'||baseCurrency!=='usd'||baseAmount!==100||
  session.total_details?.amount_discount||line?.length!==1||session.line_items?.has_more||line[0]?.quantity!==1||
  price?.unit_amount!==100||price.currency!=='usd'||!product||typeof product==='string'||product.metadata.wl_checkout_flow!==VIP_FLOW||product.metadata.wl_vip_tier!==tier.id){
  throw new Error('VIP payment amount, price or product does not match the reservation');
 }
 if(session.payment_status!=='paid'){
  const expired=session.status==='expired';
  await attemptRef.update({paymentState:expired?'expired':'pending',nextCheckAt:expired?null:new Date(Date.now()+600000).toISOString()});
  return {state:expired?'expired':'pending',eligible:false,tierName:tier.name};
 }
 const pi=session.payment_intent as Stripe.PaymentIntent;
 if(!pi||typeof pi==='string'||pi.status!=='succeeded'||!isVipObject(pi)||pi.metadata.wl_vip_attempt!==attemptId)throw new Error('VIP payment intent is not verified');
 const charge=pi.latest_charge as Stripe.Charge;
 if(!charge||typeof charge==='string'||!charge.paid)throw new Error('VIP payment has no verified paid charge');
 const email=session.customer_details?.email?.trim().toLowerCase();
 if(!email||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('VIP payment has no valid checkout email');
 if(session.consent?.terms_of_service!=='accepted')throw new Error('VIP reservation terms were not accepted');
 let disputeState:string|null=null;
 if(charge.disputed){const disputes=await stripe.disputes.list({charge:charge.id,limit:1});disputeState=disputes.data[0]?.status??'needs_response';}
 let state=charge.amount_refunded>0?'refunded':disputeState&&disputeState!=='won'?'disputed':'paid';
 const ref=db.collection('beyondVipReservations').doc(session.id),now=new Date().toISOString();
 const presentment=(session as Stripe.Checkout.Session & {presentment_details?:{presentment_amount:number;presentment_currency:string}}).presentment_details;
 await db.runTransaction(async tx=>{
  const old=(await tx.get(ref)).data();
  // A completion fetched before a concurrent refund must never re-enable VIP access.
  if(old?.state==='refunded')state='refunded';
  if(old?.state==='disputed'&&state==='paid'&&disputeState!=='won')state='disputed';
  tx.set(ref,{campaign:'WonderLang Beyond',email,tierId:tier.id,tierName:tier.name,
   normalEurCents:attempt.normalEurCents,vipEurCents:attempt.vipEurCents,discountPercent:30,
   reservationAmount:baseAmount,reservationCurrency:baseCurrency,
   chargedAmount:presentment?.presentment_amount??session.amount_total,chargedCurrency:presentment?.presentment_currency??session.currency,
   amountRefunded:Math.max(old?.amountRefunded??0,charge.amount_refunded),state,eligible:state==='paid',disputeState,
   stripeSessionId:session.id,stripePaymentIntentId:pi.id,stripeChargeId:charge.id,
   termsVersion:VIP_TERMS,termsAccepted:true,feeSeparateFromPledge:true,
   createdAt:old?.createdAt??new Date(session.created*1000).toISOString(),updatedAt:now,source,
   secretRewardLinkSentAt:old?.secretRewardLinkSentAt??null
  });
  tx.update(attemptRef,{paymentState:state,nextCheckAt:state==='refunded'?null:new Date(Date.now()+86400000).toISOString()});
 });
 return {state,eligible:state==='paid',tierName:tier.name};
}

export async function processVipStripeEvent(db:Firestore,stripe:Stripe,event:Stripe.Event){
 const value=event.data.object as any;
 if(!event.livemode)throw new Error('VIP reservations require live Stripe events');
 if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)){
  await syncVipSession(db,stripe,value.id,event.id);return;
 }
 if(event.type==='charge.refunded'||event.type.startsWith('charge.dispute.')){
  const charge=event.type==='charge.refunded'?value:typeof value.charge==='string'?await stripe.charges.retrieve(value.charge):value.charge;
  const pi=objectId(charge?.payment_intent);if(!pi)throw new Error('Missing VIP payment intent');
  const sessions=await stripe.checkout.sessions.list({payment_intent:pi,limit:2});
  if(sessions.has_more||sessions.data.length!==1)throw new Error('Cannot identify VIP checkout session');
  await syncVipSession(db,stripe,sessions.data[0]!.id,event.id);
 }
}

export async function vipStatus(db:Firestore,stripe:Stripe,sessionId:string,token:string){
 if(!/^cs_live_[A-Za-z0-9]+$/.test(sessionId)||!/^[0-9a-f]{64}$/.test(token))throw new HttpError(404,'Reservation not found.');
 const sessions=await db.collection('beyondVipCheckoutAttempts').where('sessionId','==',sessionId).limit(1).get();
 const attempt=sessions.docs[0]?.data();
 if(!attempt||typeof attempt.tokenHash!=='string'||attempt.tokenHash.length!==64||!timingSafeEqual(Buffer.from(attempt.tokenHash,'hex'),Buffer.from(hash(token),'hex')))throw new HttpError(404,'Reservation not found.');
 return syncVipSession(db,stripe,sessionId,'verified-return');
}

export async function listVipReservations(db:Firestore,cursor?:string,filters:{tier?:string;state?:string;q?:string}={}){
 const tier=filters.tier?.trim()||'',state=filters.state?.trim()||'',q=filters.q?.trim().toLowerCase()||'';
 if(tier&&!vipTier(tier))throw new HttpError(400,'Unknown reward tier.');
 if(state&&!['paid','refunded','disputed'].includes(state))throw new HttpError(400,'Unknown payment status.');
 if(q.length>254)throw new HttpError(400,'Search is too long.');
 // Scan bounded chronological pages rather than depending on new composite
 // indexes. The cursor always advances past scanned records, including pages
 // with no matches. Exports follow every page with the same filters.
 let query=db.collection('beyondVipReservations').orderBy('createdAt','desc').limit(101);
 if(cursor){if(!/^cs_live_[A-Za-z0-9]+$/.test(cursor))throw new HttpError(400,'Invalid cursor');const doc=await db.collection('beyondVipReservations').doc(cursor).get();if(!doc.exists)throw new HttpError(400,'Invalid cursor');query=query.startAfter(doc);}
 const rows=(await query.get()).docs;
 const scanned=rows.slice(0,100);
 return {reservations:scanned.filter(d=>{const r=d.data();return (!tier||r.tierId===tier)&&(!state||r.state===state)&&(!q||String(r.email??'').toLowerCase().includes(q));}).map(d=>({id:d.id,...d.data()})),
  nextCursor:rows.length>100?rows[99]!.id:null,scanned:scanned.length,filters:{tier,state,q},tiers:vipTiers.map(t=>({id:t.id,name:t.name}))};
}

export async function reconcileVipReservations(db:Firestore,stripe:Stripe){
 const now=new Date().toISOString();
 const attempts=await db.collection('beyondVipCheckoutAttempts').where('nextCheckAt','<=',now).orderBy('nextCheckAt').limit(20).get();
 let synced=0,failed=0;
 for(const doc of attempts.docs){
  const sessionId=doc.data().sessionId;
  if(!sessionId){await doc.ref.update({nextCheckAt:null,paymentState:'checkout-not-exposed'});continue;}
  try{await syncVipSession(db,stripe,sessionId,'scheduled-reconciliation');synced++;}
  catch{await doc.ref.update({nextCheckAt:new Date(Date.now()+600000).toISOString(),lastSyncFailedAt:now});failed++;}
 }
 return {synced,failed};
}
