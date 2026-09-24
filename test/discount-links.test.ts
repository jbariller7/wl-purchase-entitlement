import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { Firestore } from "firebase-admin/firestore";
import { DiscountLinks, discountLinkSchema, assertDiscountAvailable, applyDiscountToSession, type DiscountLink } from "../src/providers/stripe/discount-links.js";
import { websiteSessionSchema, websiteSessionParams } from "../src/providers/stripe/website-session.js";
import prices from "../catalog/website-prices.json" with {type:"json"};
import locales from "../catalog/website-checkout-locales.json" with {type:"json"};
import text from "../catalog/website-discount-locales.json" with {type:"json"};

const now=new Date("2026-09-23T10:00:00Z"),id="550e8400-e29b-41d4-a716-446655440001";
const input=discountLinkSchema.parse({id,name:"Autumn newsletter",offer:"premium",percentOff:25,locale:"fr",currency:"EUR",delivery:"steam",expiresAt:"2026-10-01T10:00:00Z"});
const link:DiscountLink={...input,active:true,ready:true,couponId:"coupon_campaign",createdAt:now.toISOString(),updatedAt:now.toISOString()};
const actor={uid:"admin",email:"owner@example.com"};
function fixture(){
 const records=new Map<string,any>();let next=0;
 const ref=(path:string):any=>({id:path.split('/').at(-1),path,get:async()=>({exists:records.has(path),data:()=>records.get(path)}),set:async(v:any)=>records.set(path,v),create:async(v:any)=>{if(records.has(path))throw Error('Exists');records.set(path,v);},update:async(v:any)=>records.set(path,{...records.get(path),...v}),delete:async()=>records.delete(path)});
 const collection=(path:string,filters:any[]=[]):any=>({doc:(key:string)=>ref(path+'/'+(key||String(++next))),where:(...f:any[])=>collection(path,[...filters,f]),orderBy:()=>collection(path,filters),limit:()=>collection(path,filters),get:async()=>{const docs=[...records].filter(([p,v])=>p.startsWith(path+'/')&&!p.slice(path.length+1).includes('/')&&filters.every(([key,op,value])=>op==='=='?v[key]===value:v[key]<=value)).map(([p,v])=>({id:p.split('/').at(-1),ref:ref(p),data:()=>v}));return {docs,size:docs.length};}});
 const db={collection,runTransaction:async(fn:any)=>fn({get:(r:any)=>r.get(),create:(r:any,v:any)=>r.create(v),update:(r:any,v:any)=>r.update(v)})};
 const stripe={prices:{retrieve:vi.fn(async()=>({active:true,livemode:true,product:'prod_premium'}))},coupons:{create:vi.fn(async(..._args:unknown[])=>({id:'coupon'})),retrieve:vi.fn()},checkout:{sessions:{retrieve:vi.fn(async(id:string)=>({id,status:'open'})),expire:vi.fn(async()=>({status:'expired'}))}}};
 return {records,stripe,service:new DiscountLinks(db as unknown as Firestore,stripe as unknown as Stripe,'https://wonderlang.app')};
}
describe('discount campaigns',()=>{
 it('rejects new iOS campaigns and makes existing iOS campaign links unavailable',()=>{
  expect(discountLinkSchema.safeParse({...input,delivery:undefined,offer:'mobile_permanent',mobilePlatform:'ios'}).success).toBe(false);
  expect(()=>assertDiscountAvailable({...link,offer:'mobile_permanent',mobilePlatform:'ios'},now)).toThrow(/no longer available/);
 });
 it('applies a named percentage to every currency without changing normal fulfillment metadata',()=>{
  for(const currency of Object.keys(prices)){
   const request=websiteSessionSchema.parse({offer:'premium',delivery:'steam',locale:'fr',currency,requestId:id,campaignId:id});
   const params=websiteSessionParams(request,'price_premium','https://wonderlang.app');
   params.metadata={...params.metadata,wl_request_id:id};
   applyDiscountToSession(params,link,'https://wonderlang.app',now);
   expect(params.discounts).toEqual([{coupon:'coupon_campaign'}]);
   expect(params.allow_promotion_codes).toBeUndefined();
   expect(params.line_items).toEqual([{price:'price_premium',quantity:1}]);
   expect(params.metadata).toMatchObject({wl_checkout_flow:'website-session-v1',wl_ads_owner:'entitlement-v2',wl_request_id:id,wl_website_offer:'premium',wl_desktop_delivery:'steam',wl_discount_link:id});
   expect(params.currency).toBe(currency.toLowerCase());
   expect((params.custom_text?.submit as {message:string}).message).toContain('Autumn newsletter');
   expect(params.success_url).toContain('/shop/complete/');
  }
 });
 it('rejects disabled, expired and tampered campaign selections',()=>{
  const r=websiteSessionSchema.parse({offer:'premium',delivery:'direct',locale:'en',currency:'USD',requestId:id});
  expect(()=>assertDiscountAvailable(link,now,r)).toThrow('does not match');
  expect(()=>assertDiscountAvailable({...link,active:false},now)).toThrow('no longer');
  expect(()=>assertDiscountAvailable({...link,expiresAt:now.toISOString()},now)).toThrow('no longer');
  expect(()=>assertDiscountAvailable({...link,ready:false},now)).toThrow('no longer');
  expect(websiteSessionSchema.safeParse({...r,coupon:'unauthorized'}).success).toBe(false);
 });
 it('creates an idempotent product-limited coupon and keeps the campaign name',async()=>{
  const f=fixture();await f.service.create(input,actor,now);await f.service.create(input,actor,now);
  expect(f.stripe.coupons.create).toHaveBeenCalledOnce();
  expect(f.stripe.coupons.create.mock.calls[0]![0]).toMatchObject({name:input.name,percent_off:25,duration:'once',applies_to:{products:['prod_premium']}});
  await expect(f.service.create({...input,percentOff:50},actor,now)).rejects.toThrow('different settings');
 });
 it('deactivation closes open sessions but honors already completed payments',async()=>{
  const f=fixture();f.records.set('websiteDiscountLinks/'+id,link);
  f.records.set('websiteDiscountSessions/cs_open',{campaignId:id,closeAfter:link.expiresAt});
  f.records.set('websiteDiscountSessions/cs_paid',{campaignId:id,closeAfter:link.expiresAt});
  f.stripe.checkout.sessions.retrieve.mockImplementation(async(id:string)=>({id,status:id==='cs_paid'?'complete':'open'}));
  await f.service.setActive(id,false,actor,now);
  expect((await f.service.get(id)).active).toBe(false);
  expect(f.stripe.checkout.sessions.expire).toHaveBeenCalledExactlyOnceWith('cs_open');
 });
 it('retains failed closures for the scheduled retry',async()=>{
  const f=fixture();f.records.set('websiteDiscountSessions/cs_retry',{campaignId:id,closeAfter:now.toISOString()});
  f.stripe.checkout.sessions.expire.mockRejectedValueOnce(Error('temporary Stripe error'));
  expect(await f.service.closeDueSessions(now)).toEqual({scanned:1,closed:0});
  expect(f.records.has('websiteDiscountSessions/cs_retry')).toBe(true);
  expect(await f.service.closeDueSessions(now)).toEqual({scanned:1,closed:1});
 });
 it('closes a checkout created concurrently with deactivation',async()=>{
  const f=fixture();f.records.set('websiteDiscountLinks/'+id,{...link,active:false});
  await expect(f.service.registerSession(link,{id:'cs_race',status:'open',expires_at:now.getTime()/1000+3600} as Stripe.Checkout.Session,now)).rejects.toThrow('no longer');
  expect(f.stripe.checkout.sessions.expire).toHaveBeenCalledWith('cs_race');
 });
 it('preserves the monthly trial and selected discount duration',async()=>{
  const f=fixture();await f.service.create({...input,delivery:undefined,offer:'mobile_monthly',mobilePlatform:'ios',duration:'repeating',durationMonths:3},actor,now);
  expect(f.stripe.coupons.create.mock.calls[0]![0]).toMatchObject({duration:'repeating',duration_in_months:3});
  const params=websiteSessionParams(websiteSessionSchema.parse({offer:'mobile_monthly',mobilePlatform:'ios',locale:'en',currency:'USD',requestId:id}),'price_monthly','https://wonderlang.app');
  applyDiscountToSession(params,{...link,offer:'mobile_monthly',duration:'forever'},'https://wonderlang.app',now);
  expect(params.subscription_data?.trial_period_days).toBe(3);
  expect(params.subscription_data?.metadata?.wl_checkout_flow).toBe('website-session-v1');
 });
 it('covers every shop language and rejects invalid names, durations and dates',async()=>{
  expect(Object.keys(text).sort()).toEqual(Object.keys(locales).sort());
  for(const values of Object.values(text)){expect(values).toHaveLength(4);expect(values[3]).toContain('{MONTHS}');expect(values.join()).not.toContain('\ufffd');}
  expect(discountLinkSchema.safeParse({...input,name:'a'.repeat(41)}).success).toBe(false);
  expect(discountLinkSchema.safeParse({...input,duration:'forever'}).success).toBe(false);
  await expect(fixture().service.create({...input,expiresAt:now.toISOString()},actor,now)).rejects.toThrow('future');
 });
});
