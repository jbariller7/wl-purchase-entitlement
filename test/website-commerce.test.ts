import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {EntitlementStore} from '../src/infrastructure/entitlement-store.js';
import type Stripe from 'stripe';
const api=vi.hoisted(()=>({prices:{retrieve:vi.fn()},checkout:{sessions:{create:vi.fn(),retrieve:vi.fn(),listLineItems:vi.fn()}}}));
vi.mock('../src/providers/stripe/website-config.js',()=>({websiteStripeClient:()=>api,websiteStripeConfiguration:()=>({origin:'https://wonderlang.app'}),websitePriceId:()=> 'price_approved'}));
import {startWebsiteCheckout,recordWebsitePayment} from '../src/providers/stripe/website-commerce.js';
function database(){
 const docs=new Map<string,any>();
 const db:any={collection:(name:string)=>({doc:(id:string)=>{
  const path=`${name}/${id}`;
  return {path,id,get:async()=>({exists:docs.has(path),data:()=>docs.get(path)}),set:async(data:any)=>docs.set(path,{...docs.get(path),...data})};
 }})};
 db.doc=(path:string)=>db.collection(path.split('/')[0]).doc(path.split('/')[1]);
 db.runTransaction=async(action:any)=>action({get:(ref:any)=>ref.get(),create:(ref:any,data:any)=>docs.set(ref.path,data),update:(ref:any,data:any)=>ref.set(data),set:(ref:any,data:any)=>ref.set(data)});
 const saveLegacyOrder=vi.fn(),enqueue=vi.fn();
 const store={firestore:()=>db,saveLegacyOrder,enqueue,saveCheckoutContext:vi.fn()} as unknown as EntitlementStore;
 return {docs,store,saveLegacyOrder,enqueue};
}
const request={offer:'premium' as const,locale:'fr',currency:'EUR',delivery:'steam' as const,mobilePlatform:'android' as const,requestId:'550e8400-e29b-41d4-a716-446655440000'};
const secret='a'.repeat(43);
beforeEach(()=>{
 vi.clearAllMocks();
 api.prices.retrieve.mockResolvedValue({active:true,livemode:true,type:'one_time',currency_options:{eur:{tax_behavior:'inclusive',unit_amount:5999}}});
 api.checkout.sessions.create.mockResolvedValue({id:'cs_live_new',url:'https://checkout.stripe.com/c/pay/cs_live_new'});
});
describe('website checkout runtime',()=>{
 it('carries only verified experiment enrollments into Stripe and deduplicates paid attribution',async()=>{
  const {store,docs}=database(),token='b'.repeat(64),at=Date.now();
  docs.set('websiteExperimentEnrollments/'+token,{experimentId:'hero',variant:'B',createdAt:at-1000,locale:'fr',device:'mobile',country:'FR',source:'direct',events:{exposure:true}});
  await startWebsiteCheckout(store,{...request,experimentToken:token},secret);
  const params=api.checkout.sessions.create.mock.calls[0]![0];expect(params.metadata.wl_experiment_token).toBe(token);
  api.checkout.sessions.listLineItems.mockResolvedValue({data:[{price:{id:'price_approved'},quantity:1}]});
  const paid={id:'cs_live_new',livemode:true,payment_status:'paid',metadata:params.metadata,customer_details:{email:'Buyer@example.com'},payment_intent:'pi_paid',amount_total:5999,currency:'eur'} as unknown as Stripe.Checkout.Session;
  for(let i=0;i<2;i++)await recordWebsitePayment(store,paid,{id:'evt_paid',created:Math.ceil(at/1000)} as Stripe.Event);
  expect(docs.get('websiteExperimentResults/hero').variants.B).toMatchObject({checkout:1,purchases:1,transactions:1,revenue:{EUR:5999}});
 });
 it('ignores a syntactically valid token which was never enrolled',async()=>{
  const {store}=database();await startWebsiteCheckout(store,{...request,experimentToken:'c'.repeat(64)},secret);
  expect(api.checkout.sessions.create.mock.calls[0]![0].metadata.wl_experiment_token).toBeUndefined();
 });
 it('keeps Stripe retry parameters stable if consent is withdrawn during an interrupted checkout',async()=>{
  const {store,docs}=database(),token='d'.repeat(64);
  const e={experimentId:'hero',variant:'A',createdAt:Date.now()-1000,events:{exposure:true}};docs.set('websiteExperimentEnrollments/'+token,e);
  api.checkout.sessions.create.mockRejectedValueOnce(Error('interrupted'));
  await expect(startWebsiteCheckout(store,{...request,experimentToken:token},secret)).rejects.toThrow('interrupted');
  docs.set('websiteExperimentEnrollments/'+token,{...e,withdrawn:true});
  await startWebsiteCheckout(store,{...request,experimentToken:token},secret);
  expect(api.checkout.sessions.create.mock.calls[1]).toEqual(api.checkout.sessions.create.mock.calls[0]);
  expect(docs.has('websiteExperimentResults/hero')).toBe(false);
 });
 it.each(['mobile_monthly','mobile_permanent'] as const)('blocks new %s iOS checkout before contacting Stripe',async offer=>{
  const {store}=database();
  await expect(startWebsiteCheckout(store,{offer,mobilePlatform:'ios',locale:'en',currency:'USD',requestId:request.requestId},secret)).rejects.toThrow(/not available/);
  expect(api.prices.retrieve).not.toHaveBeenCalled();
  expect(api.checkout.sessions.create).not.toHaveBeenCalled();
 });
 it('creates the live guest session without unrelated native/test feature switches',async()=>{
  const {store,docs}=database();
  const result=await startWebsiteCheckout(store,request,secret);
  expect(result.url).toMatch(/^https:\/\/checkout.stripe.com/);
  const [parameters,options]=api.checkout.sessions.create.mock.calls[0]!;
  expect(parameters.metadata).toMatchObject({wl_website_offer:'premium',wl_desktop_delivery:'steam',wl_mobile_platform:'android',wl_request_id:request.requestId});
  expect(parameters.locale).toBe('fr');expect(parameters.currency).toBe('eur');
  expect(options.idempotencyKey).toContain(request.requestId);
  const quote=docs.get(`websiteCheckoutRequests/${request.requestId}`);
  expect(quote.claimHash).not.toBe(secret);expect(quote.sessionId).toBe('cs_live_new');
 });
 it('does not create a second checkout when the first was already paid',async()=>{
  const {store}=database();await startWebsiteCheckout(store,request,secret);
  api.checkout.sessions.retrieve.mockResolvedValue({id:'cs_live_new',status:'complete'});
  expect(await startWebsiteCheckout(store,request,secret)).toEqual({completed:true,sessionId:'cs_live_new'});
  expect(api.checkout.sessions.create).toHaveBeenCalledTimes(1);
 });
 it('refuses to reuse an attempt with changed delivery choices',async()=>{
  const {store}=database();await startWebsiteCheckout(store,request,secret);
  await expect(startWebsiteCheckout(store,{...request,delivery:'direct'},secret)).rejects.toThrow(/different options/);
 });
 it('rejects a price mismatch before creating a payable checkout',async()=>{
  const {store}=database();api.prices.retrieve.mockResolvedValue({active:true,livemode:true,type:'one_time',currency_options:{eur:{tax_behavior:'inclusive',unit_amount:1}}});
  await expect(startWebsiteCheckout(store,request,secret)).rejects.toThrow(/approved website offer/);
  expect(api.checkout.sessions.create).not.toHaveBeenCalled();
 });
 it('records payment without creating a second Steam-key allocation job',async()=>{
  const {store,docs,saveLegacyOrder,enqueue}=database();await startWebsiteCheckout(store,request,secret);
  api.checkout.sessions.listLineItems.mockResolvedValue({data:[{price:{id:'price_approved'},quantity:1}]});
  const session={id:'cs_live_new',livemode:true,payment_status:'paid',metadata:{wl_request_id:request.requestId},customer_details:{email:'Buyer@example.com'},payment_intent:'pi_paid',amount_total:5999,currency:'eur'} as unknown as Stripe.Checkout.Session;
  await recordWebsitePayment(store,session,{id:'evt_paid',created:1789572000} as Stripe.Event);
  expect(docs.get('websiteOrders/cs_live_new').buyerEmail).toBe('buyer@example.com');
  expect(saveLegacyOrder).toHaveBeenCalledWith(expect.objectContaining({productCode:'POLY_STEAM',playMode:'STEAM'}));
  expect(enqueue).not.toHaveBeenCalled();
 });
 it('discounted checkout uses the normal recovery, fulfillment and attribution flow',async()=>{
  const {store,docs,saveLegacyOrder}=database();
  const campaignId='550e8400-e29b-41d4-a716-446655440001';
  docs.set('websiteDiscountLinks/'+campaignId,{id:campaignId,name:'Newsletter offer',offer:'premium',percentOff:25,active:true,ready:true,couponId:'coupon_newsletter',expiresAt:null});
  api.checkout.sessions.create.mockResolvedValue({id:'cs_discount',status:'open',expires_at:Math.floor(Date.now()/1000)+3600,url:'https://checkout.stripe.com/c/pay/cs_discount'});
  await startWebsiteCheckout(store,{...request,campaignId},secret);
  const params=api.checkout.sessions.create.mock.calls[0]![0];
  expect(params.discounts).toEqual([{coupon:'coupon_newsletter'}]);
  expect(params.metadata).toMatchObject({wl_checkout_flow:'website-session-v1',wl_ads_owner:'entitlement-v2',wl_discount_link:campaignId,wl_request_id:request.requestId});
  expect(store.saveCheckoutContext).toHaveBeenCalledWith('cs_discount',expect.any(Object),expect.any(Date));
  expect(docs.has('websiteDiscountSessions/cs_discount')).toBe(true);
  api.checkout.sessions.listLineItems.mockResolvedValue({data:[{price:{id:'price_approved'},quantity:1}]});
  await recordWebsitePayment(store,{id:'cs_discount',livemode:true,payment_status:'paid',metadata:params.metadata,customer_details:{email:'Buyer@example.com'},payment_intent:'pi_discount',amount_total:4499,currency:'eur'} as unknown as Stripe.Checkout.Session,{id:'evt_discount',created:1789572000} as Stripe.Event);
  expect(docs.get('websiteOrders/cs_discount').request.campaignId).toBe(campaignId);
  expect(saveLegacyOrder).toHaveBeenCalledWith(expect.objectContaining({productCode:'POLY_STEAM',playMode:'STEAM'}));
 });
 it('keeps discounted Stripe parameters identical after an interrupted response',async()=>{
  const {store,docs}=database();const campaignId='550e8400-e29b-41d4-a716-446655440001';
  docs.set('websiteDiscountLinks/'+campaignId,{id:campaignId,name:'Retry offer',offer:'premium',percentOff:20,active:true,ready:true,couponId:'coupon_retry',expiresAt:null});
  api.checkout.sessions.create.mockRejectedValueOnce(Error('network interruption'));
  await expect(startWebsiteCheckout(store,{...request,campaignId},secret)).rejects.toThrow('network interruption');
  api.checkout.sessions.create.mockResolvedValue({id:'cs_retry',status:'open',expires_at:Math.floor(Date.now()/1000)+3600,url:'https://checkout.stripe.com/c/pay/cs_retry'});
  await startWebsiteCheckout(store,{...request,campaignId},secret);
  expect(api.checkout.sessions.create.mock.calls[1]).toEqual(api.checkout.sessions.create.mock.calls[0]);
 });
 it('does not accept a test payment as a live website purchase',async()=>{
  const {store}=database();
  await expect(recordWebsitePayment(store,{livemode:false} as Stripe.Checkout.Session,{} as Stripe.Event)).rejects.toThrow(/must be live/);
 });
});
