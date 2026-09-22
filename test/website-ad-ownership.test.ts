import {afterEach,expect,it,vi} from 'vitest';
import {resetEnvironmentForTests} from '../src/config/env.js';
const mocks=vi.hoisted(()=>({record:vi.fn()}));
vi.mock('../src/providers/stripe/website-commerce.js',()=>({recordWebsitePayment:mocks.record}));
import {processStripeEvent} from '../src/providers/stripe/event-processor.js';
const original={...process.env};
afterEach(()=>{process.env={...original};resetEnvironmentForTests();vi.clearAllMocks()});
it.each(['single','polyglot','premium','mobile_permanent'])('queues %s website payment with its Stripe ID and original attribution',async offer=>{
 process.env.AD_CONVERSIONS_ENABLED='true';resetEnvironmentForTests();
 mocks.record.mockResolvedValue({offer});
 const enqueue=vi.fn();
 const store={checkoutContext:vi.fn().mockResolvedValue({eventSourceUrl:'https://wonderlang.app/shop/',fbp:'fb.1.123.browser',fbc:'fb.1.123.click',userAgent:'browser',ipAddress:'192.0.2.1'}),enqueue};
 const event={id:'evt_test',type:'checkout.session.completed',created:1790000000,livemode:true,data:{object:{id:'cs_live_paid',mode:'payment',payment_status:'paid',amount_total:2499,currency:'eur',customer_details:{email:'Buyer@example.com'},metadata:{wl_checkout_flow:'website-session-v1',wl_ads_owner:'entitlement-v2'}}}};
 await processStripeEvent(store as any,event as any);
 expect(enqueue).toHaveBeenCalledWith('meta_conversion','meta:cs_live_paid',expect.objectContaining({eventId:'cs_live_paid',eventName:'Purchase',value:24.99,currency:'EUR',product:offer,fbp:'fb.1.123.browser',fbc:'fb.1.123.click',userAgent:'browser'}),expect.any(Date));
});
it('leaves older desktop checkouts to the existing legacy reporter',async()=>{
 process.env.AD_CONVERSIONS_ENABLED='true';resetEnvironmentForTests();mocks.record.mockResolvedValue({offer:'polyglot'});
 const store={checkoutContext:vi.fn(),enqueue:vi.fn()};
 await processStripeEvent(store as any,{type:'checkout.session.completed',created:1790000000,livemode:true,data:{object:{id:'cs_older',mode:'payment',payment_status:'paid',metadata:{wl_checkout_flow:'website-session-v1'}}}} as any);
 expect(store.enqueue).not.toHaveBeenCalled();
});
