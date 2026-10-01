import {beforeEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
const mocks=vi.hoisted(()=>({retrieve:vi.fn(),get:vi.fn(),set:vi.fn().mockResolvedValue(undefined),limit:vi.fn(),origin:'https://wonderlang.test'}));
vi.mock('../src/providers/stripe/website-config.js',()=>({websiteStripeConfiguration:()=>({origin:mocks.origin}),websiteStripeClient:()=>({checkout:{sessions:{retrieve:mocks.retrieve}}})}));
vi.mock('../src/infrastructure/firebase.js',()=>({firestore:()=>({collection:()=>({doc:()=>({get:mocks.get,set:mocks.set})})})}));
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
 const paid={...session,created:Math.floor(Date.now()/1000),mode:'payment',customer_details:{email:'Buyer@Example.com'},metadata:{...session.metadata,wl_ads_owner:'entitlement-v2',wl_website_offer:'premium'}};
 mocks.retrieve.mockResolvedValue(paid);
 const body=JSON.parse((await call({sessionId:session.id,claimSecret:secret})).body);
 expect(body.conversion.meta).toEqual({pixelId:'552284573796131',eventId:session.id,eventName:'Purchase',product:'premium',emailSha256:createHash('sha256').update('buyer@example.com').digest('hex')});
 mocks.retrieve.mockResolvedValue({...paid,created:paid.created-3*86400});
 expect(JSON.parse((await call({sessionId:session.id,claimSecret:secret})).body).conversion.meta).toBeUndefined();
 } finally { if(oldPixel===undefined)delete process.env.META_PIXEL_ID;else process.env.META_PIXEL_ID=oldPixel;if(oldEnabled===undefined)delete process.env.AD_CONVERSIONS_ENABLED;else process.env.AD_CONVERSIONS_ENABLED=oldEnabled; }
});
it('rejects unrelated origin or incorrect recovery secret',async()=>{
 expect((await call({sessionId:session.id,claimSecret:secret},'https://attacker.test')).statusCode).toBe(403);
 expect(mocks.retrieve).not.toHaveBeenCalled();
 expect((await call({sessionId:session.id,claimSecret:'a'.repeat(43)})).statusCode).toBe(404);
});
it('accepts the scoped return token without browser storage and rejects the claim hash as a token',async()=>{
 const token=createHash('sha256').update('wonderlang-conversion-v1:'+secret).digest('hex');
 mocks.get.mockResolvedValue({data:()=>({sessionId:session.id,claimHash:createHash('sha256').update(secret).digest('hex'),conversionTokenHash:createHash('sha256').update(token).digest('hex')})});
 expect((await call({sessionId:session.id,conversionToken:token})).statusCode).toBe(200);
 expect((await call({sessionId:session.id,conversionToken:createHash('sha256').update(secret).digest('hex')})).statusCode).toBe(404);
 expect((await call({sessionId:session.id,conversionToken:token,claimSecret:secret})).statusCode).toBe(400);
 mocks.retrieve.mockResolvedValue({...session,status:'open',payment_status:'unpaid'});
 expect(JSON.parse((await call({sessionId:session.id,conversionToken:token})).body).conversion).toBeNull();
});
it('returns original matching identifiers only to the purchase owner and honors checkout opt-out',async()=>{
 vi.stubEnv('META_PIXEL_ID','552284573796131');vi.stubEnv('AD_CONVERSIONS_ENABLED','true');
 try{
 const attribution={fbp:'fb.1.123.originalBrowser',fbc:'fb.1.123.'+'X'.repeat(650)};
 const quote={sessionId:session.id,claimHash:createHash('sha256').update(secret).digest('hex'),request:{attribution}};
 mocks.get.mockResolvedValue({data:()=>quote});
 mocks.retrieve.mockResolvedValue({...session,mode:'payment',created:Math.floor(Date.now()/1000),metadata:{...session.metadata,wl_ads_owner:'entitlement-v2'}});
 expect(JSON.parse((await call({sessionId:session.id,claimSecret:secret})).body).conversion.meta).toMatchObject(attribution);
 mocks.get.mockResolvedValue({data:()=>({...quote,request:{attribution:{metaOptOut:'1'}}})});
 expect(JSON.parse((await call({sessionId:session.id,claimSecret:secret})).body).conversion.meta).toBeUndefined();
 }finally{vi.unstubAllEnvs()}
});
it('does not report free trials, incomplete checkouts, or sandbox purchases',async()=>{
 for(const fields of [{amount_total:0,payment_status:'no_payment_required'},{status:'open',payment_status:'unpaid'}]){
 mocks.retrieve.mockResolvedValue({...session,...fields});expect(JSON.parse((await call({sessionId:session.id,claimSecret:secret})).body)).toEqual({conversion:null});}
 mocks.retrieve.mockResolvedValue({...session,livemode:false});expect((await call({sessionId:session.id,claimSecret:secret})).statusCode).toBe(404);
});
