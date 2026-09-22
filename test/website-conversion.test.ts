import {beforeEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
const mocks=vi.hoisted(()=>({retrieve:vi.fn(),get:vi.fn(),limit:vi.fn(),origin:'https://wonderlang.test'}));
vi.mock('../src/providers/stripe/website-config.js',()=>({websiteStripeConfiguration:()=>({origin:mocks.origin}),websiteStripeClient:()=>({checkout:{sessions:{retrieve:mocks.retrieve}}})}));
vi.mock('../src/infrastructure/firebase.js',()=>({firestore:()=>({collection:()=>({doc:()=>({get:mocks.get})})})}));
vi.mock('../src/http/rate-limit.js',()=>({consumeRateLimit:mocks.limit}));
import {lambdaHandler} from '../netlify/functions/website-conversion.js';
const secret='x'.repeat(43);
const session={id:'cs_live_abc123',livemode:true,metadata:{wl_request_id:'request',wl_checkout_flow:'website-session-v1'},status:'complete',payment_status:'paid',amount_total:3199,currency:'eur'};
async function call(body:object,origin='https://wonderlang.test'){return await lambdaHandler({httpMethod:'POST',headers:{origin},body:JSON.stringify(body)} as never,{} as never) as {statusCode:number;body:string};}
beforeEach(()=>{vi.clearAllMocks();mocks.origin='https://wonderlang.test';mocks.retrieve.mockResolvedValue({...session});mocks.get.mockResolvedValue({data:()=>({sessionId:session.id,claimHash:createHash('sha256').update(secret).digest('hex')})});});
it('supports pending purchases on the old domain after the production migration',async()=>{
 mocks.origin='https://wonderlang.app';
 expect((await call({sessionId:session.id,claimSecret:secret},'https://wl-purchase-entitlement.netlify.app')).statusCode).toBe(200);
 expect((await call({sessionId:session.id,claimSecret:secret},'https://wonderlang.app.evil.test')).statusCode).toBe(403);
 expect((await call({sessionId:session.id,claimSecret:'a'.repeat(43)},'https://wl-purchase-entitlement.netlify.app')).statusCode).toBe(404);
});
it('returns only verified amount and currency for the checkout owner',async()=>{
 const result=await call({sessionId:session.id,claimSecret:secret});expect(result.statusCode).toBe(200);
 expect(JSON.parse(result.body)).toEqual({conversion:{transactionId:session.id,value:31.99,currency:'EUR'}});
});
it('pairs the new website browser Purchase with the server session ID and hashed email',async()=>{
 const oldPixel=process.env.META_PIXEL_ID,oldEnabled=process.env.AD_CONVERSIONS_ENABLED;
 try {
 process.env.META_PIXEL_ID='552284573796131';process.env.AD_CONVERSIONS_ENABLED='true';
 mocks.retrieve.mockResolvedValue({...session,mode:'payment',customer_details:{email:'Buyer@Example.com'},metadata:{...session.metadata,wl_ads_owner:'entitlement-v2',wl_website_offer:'premium'}});
 const body=JSON.parse((await call({sessionId:session.id,claimSecret:secret})).body);
 expect(body.conversion.meta).toEqual({pixelId:'552284573796131',eventId:session.id,eventName:'Purchase',product:'premium',emailSha256:createHash('sha256').update('buyer@example.com').digest('hex')});
 } finally { if(oldPixel===undefined)delete process.env.META_PIXEL_ID;else process.env.META_PIXEL_ID=oldPixel;if(oldEnabled===undefined)delete process.env.AD_CONVERSIONS_ENABLED;else process.env.AD_CONVERSIONS_ENABLED=oldEnabled; }
});
it('rejects unrelated origin or incorrect recovery secret',async()=>{
 expect((await call({sessionId:session.id,claimSecret:secret},'https://attacker.test')).statusCode).toBe(403);
 expect(mocks.retrieve).not.toHaveBeenCalled();
 expect((await call({sessionId:session.id,claimSecret:'a'.repeat(43)})).statusCode).toBe(404);
});
it('does not report free trials, incomplete checkouts, or sandbox purchases',async()=>{
 for(const fields of [{amount_total:0,payment_status:'no_payment_required'},{status:'open',payment_status:'unpaid'}]){
 mocks.retrieve.mockResolvedValue({...session,...fields});expect(JSON.parse((await call({sessionId:session.id,claimSecret:secret})).body)).toEqual({conversion:null});}
 mocks.retrieve.mockResolvedValue({...session,livemode:false});expect((await call({sessionId:session.id,claimSecret:secret})).statusCode).toBe(404);
});
