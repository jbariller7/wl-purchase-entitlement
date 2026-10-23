import {beforeEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({sale:vi.fn(),get:vi.fn()}));
vi.mock('../src/infrastructure/firebase.js',()=>({firestore:()=>({})}));
vi.mock('../src/providers/stripe/discount-links.js',()=>({
 DiscountLinks:class {saleCampaigns=mocks.sale;get=mocks.get;},
 assertDiscountAvailable:()=>{},campaignOffers:()=>['premium'],discountForOffer:(v:unknown)=>v
}));
import {lambdaHandler} from '../netlify/functions/website-discount.js';
const run=(params:Record<string,string>,method='GET')=>lambdaHandler({httpMethod:method,queryStringParameters:params} as any,{} as any) as Promise<any>;
beforeEach(()=>vi.clearAllMocks());
it('caches only public success responses and never exposes private coupon fields',async()=>{
 mocks.sale.mockResolvedValue([{id:'one',name:'Sale',offer:'premium',percentOff:10,couponId:'private-coupon',expiresAt:null}]);
 const r=await run({placement:'website'});
 expect(r.headers['netlify-cdn-cache-control']).toContain('max-age=1800');
 expect(r.body).not.toContain('private-coupon');
 expect(JSON.parse(r.body).campaigns[0].percentOff).toBe(10);
});
it('keeps public campaign IDs distinct and leaves failures uncacheable',async()=>{
 mocks.get.mockResolvedValue({id:'one',offer:'premium',expiresAt:null});
 expect((await run({id:'one'})).headers['netlify-vary']).toBe('query=placement|id');
 mocks.get.mockRejectedValue(new Error('unavailable'));
 const r=await run({id:'two'});
 expect(r.statusCode).toBe(500);expect(r.headers['cache-control']).toBe('no-store');
 expect(r.headers['netlify-cdn-cache-control']).toBe('no-store');
 expect((await run({},'POST')).headers['cache-control']).toBe('no-store');
});
