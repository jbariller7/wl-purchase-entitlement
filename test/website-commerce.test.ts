import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {EntitlementStore} from '../src/infrastructure/entitlement-store.js';
import type Stripe from 'stripe';
const api=vi.hoisted(()=>({prices:{retrieve:vi.fn()},checkout:{sessions:{create:vi.fn(),retrieve:vi.fn(),listLineItems:vi.fn()}}}));
vi.mock('../src/providers/stripe/website-config.js',()=>({websiteStripeClient:()=>api,websiteStripeConfiguration:()=>({origin:'https://wl-purchase-entitlement.netlify.app'}),websitePriceId:()=> 'price_approved'}));
import {startWebsiteCheckout,recordWebsitePayment} from '../src/providers/stripe/website-commerce.js';
function database(){
 const docs=new Map<string,any>();
 const db:any={collection:(name:string)=>({doc:(id:string)=>{
  const path=`${name}/${id}`;
  return {path,id,get:async()=>({exists:docs.has(path),data:()=>docs.get(path)}),set:async(data:any)=>docs.set(path,{...docs.get(path),...data})};
 }})};
 db.runTransaction=async(action:any)=>action({get:(ref:any)=>ref.get(),create:(ref:any,data:any)=>docs.set(ref.path,data),update:(ref:any,data:any)=>ref.set(data)});
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
 it('does not accept a test payment as a live website purchase',async()=>{
  const {store}=database();
  await expect(recordWebsitePayment(store,{livemode:false} as Stripe.Checkout.Session,{} as Stripe.Event)).rejects.toThrow(/must be live/);
 });
});
