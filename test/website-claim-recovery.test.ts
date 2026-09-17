import {describe,it,expect,vi,beforeEach} from 'vitest';
const retrieve=vi.hoisted(()=>vi.fn());
vi.mock('../src/providers/stripe/website-config.js',()=>({websiteStripeClient:()=>({checkout:{sessions:{retrieve}}})}));
import {discoverWebsitePurchases} from '../src/providers/stripe/website-commerce.js';
function fixture(owner:string,grants:any[]=[]){
 const order={claimedByUid:owner,buyerEmail:'buyer@example.com'};
 const doc={id:'cs_purchase',exists:true,data:()=>order};
 const db={collection:()=>({where:(field:string)=>({limit:()=>({get:async()=>({docs:field==='buyerEmail'?[doc]:[]})})}),doc:()=>({get:async()=>doc})})};
 return {firestore:()=>db,grantsForUid:async()=>grants} as any;
}
beforeEach(()=>{retrieve.mockReset();});
describe('interrupted website claim recovery',()=>{
 it('retries the reserved owner when a prior attempt did not create its grant',async()=>{
  retrieve.mockRejectedValue(new Error('Stripe temporarily unavailable'));
  await expect(discoverWebsitePurchases(fixture('buyer'),{uid:'buyer',email:'buyer@example.com',email_verified:true} as any)).rejects.toThrow('Stripe temporarily unavailable');
  expect(retrieve).toHaveBeenCalledTimes(1);
 });
 it('never takes another account purchase or replays an existing grant',async()=>{
  for(const store of [fixture('someone-else'),fixture('buyer',[{metadata:{stripeCheckoutSessionId:'cs_purchase'}}])]){
   await discoverWebsitePurchases(store,{uid:'buyer',email:'buyer@example.com',email_verified:true} as any);
  }
  expect(retrieve).not.toHaveBeenCalled();
 });
});
