import {describe,it,expect,vi} from 'vitest';
const controls=vi.hoisted(()=>({AD_CONVERSIONS_ENABLED:true}));
vi.mock('../src/config/env.js',()=>({deploymentControls:()=>controls}));
import {vipAttribution} from '../src/beyond-vip/attribution.js';
import {createHash} from 'node:crypto';
import {VIP_FLOW,VIP_TERMS,vipTiers} from '../src/beyond-vip/catalog.js';
import {createVipCheckout,syncVipSession,vipStatus,processVipStripeEvent,isVipStripeEvent,reconcileVipReservations} from '../src/beyond-vip/service.js';
const attemptId='87c65c00-c2e0-4e22-9275-a7f582404217';
function fixture(){
 const docs=new Map<string,any>();
 const snap=(path:string)=>({id:path.split('/').at(-1),exists:docs.has(path),data:()=>docs.get(path)});
 const ref=(path:string):any=>({path,id:path.split('/').at(-1),get:async()=>snap(path),create:async(v:any)=>{if(docs.has(path))throw Error('exists');docs.set(path,v)},update:async(v:any)=>docs.set(path,{...docs.get(path),...v})});
 const db:any={
  collection:(name:string)=>({
   doc:(id:string)=>ref(name+'/'+id),
   where:(key:string,_op:string,value:any)=>({limit:()=>({
    get:async()=>({docs:[...docs].filter(([path,v])=>path.startsWith(name+'/')&&v[key]===value).map(([path])=>snap(path))})
   })})
  }),
  runTransaction:async(fn:any)=>fn({get:(r:any)=>r.get(),create:(r:any,v:any)=>{if(docs.has(r.path))throw Error('exists');docs.set(r.path,v)},set:(r:any,v:any)=>docs.set(r.path,v),update:(r:any,v:any)=>docs.set(r.path,{...docs.get(r.path),...v})})
 };
 const metadata={wl_checkout_flow:VIP_FLOW,wl_vip_tier:'adventurer',wl_vip_attempt:attemptId,wl_terms:VIP_TERMS};
 const charge:any={id:'ch_paid',paid:true,amount:100,currency:'usd',amount_refunded:0,disputed:false};
 const pi:any={id:'pi_paid',status:'succeeded',metadata,latest_charge:charge};
 const session:any={id:'cs_live_test123',metadata,mode:'payment',livemode:true,created:1792663200,currency:'usd',amount_total:100,amount_subtotal:100,payment_status:'paid',status:'complete',total_details:{amount_discount:0},consent:{terms_of_service:'accepted'},customer_details:{email:'Buyer@Example.com'},payment_intent:pi,
  line_items:{has_more:false,data:[{quantity:1,price:{currency:'usd',unit_amount:100,product:{metadata:{wl_checkout_flow:VIP_FLOW,wl_vip_tier:'adventurer'}}}}]}};
 const api:any={checkout:{sessions:{retrieve:vi.fn().mockResolvedValue(session),create:vi.fn().mockResolvedValue({id:'cs_live_new',url:'https://checkout.stripe.com/c/pay/cs_live_new'}),list:vi.fn().mockResolvedValue({has_more:false,data:[session]})}},paymentIntents:{retrieve:vi.fn().mockResolvedValue(pi)},charges:{retrieve:vi.fn().mockResolvedValue(charge)},disputes:{list:vi.fn().mockResolvedValue({data:[{status:'needs_response'}]})}};
 docs.set('beyondVipCheckoutAttempts/'+attemptId,{sessionId:session.id,tierId:'adventurer',normalEurCents:2900,vipEurCents:2030,termsVersion:VIP_TERMS});
 return {db,docs,session,api,charge,pi};
}
describe('Beyond VIP paid reservation contract',()=>{
 it('has eleven tiers, no Early Bird, and exactly 30 percent off every price',()=>{
  expect(vipTiers).toHaveLength(11);expect(vipTiers.some(t=>t.id==='early')).toBe(false);
  for(const t of vipTiers){expect(t.vip*10).toBe(t.normal*7);expect(Number.isInteger(t.vip)).toBe(true)}
 });
 it('creates a fixed one-off US$1 checkout with email collected by Stripe and terms, without a game entitlement',async()=>{
  const f=fixture();await createVipCheckout(f.db,f.api,'adventurer','https://wonderlang.app');
  const [p]=f.api.checkout.sessions.create.mock.calls[0];
  expect(p).toMatchObject({mode:'payment',allow_promotion_codes:false,adaptive_pricing:{enabled:true},consent_collection:{terms_of_service:'required'},payment_intent_data:{metadata:{wl_checkout_flow:VIP_FLOW,wl_vip_tier:'adventurer'}}});
  expect(p.line_items).toMatchObject([{quantity:1,price_data:{currency:'usd',unit_amount:100,tax_behavior:'inclusive'}}]);
  expect(p.custom_text.submit.message).toMatch(/separate/);expect(p.success_url).toMatch(/reserved.html\?session_id=\{CHECKOUT_SESSION_ID\}&token=[0-9a-f]{64}$/);
  expect([...f.docs.keys()].some(k=>k.startsWith('beyondVipReservations/'))).toBe(false);
 });
 it('rejects removed or tampered tier IDs before creating a payment',async()=>{
  const f=fixture();await expect(createVipCheckout(f.db,f.api,'early','https://wonderlang.app')).rejects.toThrow(/available/);expect(f.api.checkout.sessions.create).not.toHaveBeenCalled();
 });
 it('will not expose a checkout if the database cannot save its attempt',async()=>{
  const f=fixture();f.db.collection=()=>({doc:()=>({create:async()=>{throw Error('database unavailable')}})});
  await expect(createVipCheckout(f.db,f.api,'adventurer','https://wonderlang.app')).rejects.toThrow(/database/);expect(f.api.checkout.sessions.create).not.toHaveBeenCalled();
 });
 it('stores authoritative email, tier and prices exactly once per paid session on duplicate deliveries',async()=>{
  const f=fixture();await syncVipSession(f.db,f.api,f.session.id,'evt_1');await syncVipSession(f.db,f.api,f.session.id,'evt_1');
  const r=f.docs.get('beyondVipReservations/'+f.session.id);
  expect(r).toMatchObject({email:'buyer@example.com',tierId:'adventurer',normalEurCents:2900,vipEurCents:2030,reservationAmount:100,reservationCurrency:'usd',feeSeparateFromPledge:true,state:'paid',eligible:true});
  expect([...f.docs.keys()].filter(k=>k.startsWith('beyondVipReservations/'))).toHaveLength(1);
  expect([...f.docs.keys()].every(k=>k.startsWith('beyondVip'))).toBe(true);
 });
 it('does not create an eligibility record for pending payments',async()=>{
  const f=fixture();f.session.payment_status='unpaid';expect(await syncVipSession(f.db,f.api,f.session.id,'evt')).toMatchObject({state:'pending',eligible:false});expect(f.docs.has('beyondVipReservations/'+f.session.id)).toBe(false);
 });
 it.each(['amount','currency','quantity','product','attempt','consent','email','testmode'])('rejects invalid %s',async kind=>{
  const f=fixture();
  if(kind==='amount')f.session.amount_total=1;
  if(kind==='currency')f.session.currency='eur';
  if(kind==='quantity')f.session.line_items.data[0].quantity=2;
  if(kind==='product')f.session.line_items.data[0].price.product.metadata.wl_vip_tier='god';
  if(kind==='attempt')f.session.metadata.wl_vip_attempt='../bad';
  if(kind==='consent')f.session.consent.terms_of_service=null;
  if(kind==='email')f.session.customer_details.email=null;
  if(kind==='testmode')f.session.livemode=false;
  await expect(syncVipSession(f.db,f.api,f.session.id,'evt')).rejects.toThrow();expect(f.docs.has('beyondVipReservations/'+f.session.id)).toBe(false);
 });
 it('records actual local presentment without assuming USD and local amounts are identical',async()=>{
  const f=fixture();f.session.presentment_details={presentment_amount:150,presentment_currency:'cad'};
  await syncVipSession(f.db,f.api,f.session.id,'evt');expect(f.docs.get('beyondVipReservations/'+f.session.id)).toMatchObject({chargedAmount:150,chargedCurrency:'cad',reservationCurrency:'usd'});
 });
 it('uses the verified final inclusive-tax price rather than assuming a net subtotal',async()=>{
  const f=fixture();f.session.amount_subtotal=83;f.session.total_details.amount_tax=17;
  expect(await syncVipSession(f.db,f.api,f.session.id,'evt_tax')).toMatchObject({eligible:true});
 });
 it('accepts Stripe localized totals only when the original source charge is exactly US$1',async()=>{
  const f=fixture();f.session.currency='cad';f.session.amount_total=150;f.session.amount_subtotal=150;f.session.currency_conversion={source_currency:'usd',amount_total:100,amount_subtotal:100,fx_rate:'1.50'};
  await syncVipSession(f.db,f.api,f.session.id,'evt');expect(f.docs.get('beyondVipReservations/'+f.session.id)).toMatchObject({reservationAmount:100,reservationCurrency:'usd',chargedAmount:150,chargedCurrency:'cad'});
  f.session.currency_conversion.amount_total=200;await expect(syncVipSession(f.db,f.api,f.session.id,'evt')).rejects.toThrow(/amount/);
 });
 it('refunds invalidate eligibility and a late completion cannot restore it',async()=>{
  const f=fixture();f.charge.amount_refunded=100;await syncVipSession(f.db,f.api,f.session.id,'refund');
  f.charge.amount_refunded=0;expect(await syncVipSession(f.db,f.api,f.session.id,'late-completion')).toMatchObject({state:'refunded',eligible:false});expect(f.docs.get('beyondVipReservations/'+f.session.id).amountRefunded).toBe(100);
 });
 it('disputes invalidate eligibility and only an authoritative won dispute restores it',async()=>{
  const f=fixture();f.charge.disputed=true;expect(await syncVipSession(f.db,f.api,f.session.id,'dispute')).toMatchObject({eligible:false});
  f.api.disputes.list.mockResolvedValue({data:[{status:'won'}]});expect(await syncVipSession(f.db,f.api,f.session.id,'won')).toMatchObject({state:'paid',eligible:true});
 });
 it('requires an unguessable return token and never exposes the payer email in its public response',async()=>{
  const f=fixture(),token='a'.repeat(64);Object.assign(f.docs.get('beyondVipCheckoutAttempts/'+attemptId),{tokenHash:createHash('sha256').update(token).digest('hex')});
  await expect(vipStatus(f.db,f.api,f.session.id,'b'.repeat(64))).rejects.toThrow(/not found/);
  const status=await vipStatus(f.db,f.api,f.session.id,token);expect(status).toMatchObject({eligible:true});expect(JSON.stringify(status)).not.toContain('buyer');expect(status).not.toHaveProperty('email');
 });
 it('routes only VIP Stripe events and fetches the original checkout after a refund',async()=>{
  const f=fixture();expect(await isVipStripeEvent({type:'checkout.session.completed',data:{object:{metadata:{}}}} as any,f.api)).toBe(false);
  f.charge.payment_intent='pi_paid';f.charge.amount_refunded=100;
  const event:any={id:'evt_refund',type:'charge.refunded',livemode:true,data:{object:f.charge}};
  expect(await isVipStripeEvent(event,f.api)).toBe(true);await processVipStripeEvent(f.db,f.api,event);expect(f.docs.get('beyondVipReservations/'+f.session.id).eligible).toBe(false);
 });
 it('recovers a paid reservation when the customer never returns and a webhook is missed',async()=>{
  const f=fixture(),collection=f.db.collection,attempt=f.docs.get('beyondVipCheckoutAttempts/'+attemptId);
  f.db.collection=(name:string)=>name!=='beyondVipCheckoutAttempts'?collection(name):{
   ...collection(name),where:()=>({orderBy:()=>({limit:()=>({get:async()=>({docs:[{data:()=>attempt,ref:{update:async(v:any)=>Object.assign(attempt,v)}}]})})})})
  };
  expect(await reconcileVipReservations(f.db,f.api)).toEqual({synced:1,failed:0});
  expect(f.docs.get('beyondVipReservations/'+f.session.id)).toMatchObject({email:'buyer@example.com',eligible:true,source:'scheduled-reconciliation'});
  expect(Date.parse(f.docs.get('beyondVipCheckoutAttempts/'+attemptId).nextCheckAt)).toBeGreaterThan(Date.now());
 });
});

describe('VIP Meta purchase reporting',()=>{
 function tracked(){const f=fixture();f.charge.created=Math.floor(Date.now()/1000)-30;Object.assign(f.docs.get('beyondVipCheckoutAttempts/'+attemptId),{metaTrackingVersion:1,attribution:{fbp:'fb.1.123.browser',fbc:'fb.1.123.click'}});return f;}
 const jobs=(f:ReturnType<typeof fixture>)=>[...f.docs].filter(([k])=>k.startsWith('outbox/')).map(([,v])=>v);
 it('atomically queues one USD 1 Purchase across webhook, return and reconciliation retries',async()=>{
  const f=tracked();
  for(const source of ['evt_1','verified-return','scheduled-reconciliation'])await syncVipSession(f.db,f.api,f.session.id,source);
  expect(jobs(f)).toHaveLength(1);
  expect(jobs(f)[0]).toMatchObject({kind:'meta_conversion',state:'pending',payload:{eventName:'Purchase',eventId:'beyond-vip:'+f.session.id,eventTime:f.charge.created,value:1,currency:'USD',product:'WonderLang_Beyond_VIP_adventurer',conversionKind:'beyond_vip_reservation',fbp:'fb.1.123.browser',fbc:'fb.1.123.click',emailSha256:createHash('sha256').update('buyer@example.com').digest('hex')}});
  expect(JSON.stringify(jobs(f))).not.toContain('Buyer@');
  expect(f.docs.get('beyondVipReservations/'+f.session.id).metaConversionEventId).toBe('beyond-vip:'+f.session.id);
 });
 it.each(['pending','refund','dispute','optout','old','historical','disabled'])('does not report %s',async kind=>{
  const f=tracked(),attempt=f.docs.get('beyondVipCheckoutAttempts/'+attemptId);
  if(kind==='pending')f.session.payment_status='unpaid';
  if(kind==='refund')f.charge.amount_refunded=100;
  if(kind==='dispute')f.charge.disputed=true;
  if(kind==='optout')attempt.attribution={metaOptOut:'1'};
  if(kind==='old')f.charge.created-=8*86400;
  if(kind==='historical')delete attempt.metaTrackingVersion;
  if(kind==='disabled')controls.AD_CONVERSIONS_ENABLED=false;
  try{await syncVipSession(f.db,f.api,f.session.id,'evt');expect(jobs(f)).toHaveLength(0);}finally{controls.AD_CONVERSIONS_ENABLED=true;}
 });
 it('reports the verified USD base fee when Stripe charges a local equivalent',async()=>{
  const f=tracked();f.session.currency='cad';f.session.amount_total=150;f.session.currency_conversion={source_currency:'usd',amount_total:100};
  await syncVipSession(f.db,f.api,f.session.id,'evt');expect(jobs(f)[0].payload).toMatchObject({value:1,currency:'USD'});
 });
 it('does not recreate a conversion after its delivery record is removed',async()=>{
  const f=tracked();await syncVipSession(f.db,f.api,f.session.id,'evt');for(const key of f.docs.keys())if(key.startsWith('outbox/'))f.docs.delete(key);
  await syncVipSession(f.db,f.api,f.session.id,'retry');expect(jobs(f)).toHaveLength(0);
 });
 it('captures bounded attribution and honors both GPC and explicit opt-out',()=>{
  expect(vipAttribution({fbc:'fb.1.123.click'},{'x-nf-client-connection-ip':'192.0.2.1','user-agent':'Browser',cookie:'_fbp=fb.1.123.browser'})).toEqual({fbp:'fb.1.123.browser',fbc:'fb.1.123.click',ipAddress:'192.0.2.1',userAgent:'Browser'});
  expect(vipAttribution({fbc:'fb.1.123.click'},{'sec-gpc':'1'})).toEqual({metaOptOut:'1'});
  expect(vipAttribution({metaOptOut:'1'},{})).toEqual({metaOptOut:'1'});
  expect(vipAttribution({fbc:'bad'},{'x-nf-client-connection-ip':'invalid'})).toEqual({});
 });
});
