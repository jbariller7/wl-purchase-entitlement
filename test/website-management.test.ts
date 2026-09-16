import {beforeEach,describe,it,expect,vi} from 'vitest';
import type {EntitlementStore} from '../src/infrastructure/entitlement-store.js';
import type {DecodedIdToken} from 'firebase-admin/auth';
const api=vi.hoisted(()=>({subscriptions:{retrieve:vi.fn(),list:vi.fn()},billingPortal:{configurations:{list:vi.fn(),create:vi.fn()},sessions:{create:vi.fn()}}}));
vi.mock('../src/providers/stripe/website-config.js',()=>({websiteStripeClient:()=>api,websiteStripeConfiguration:()=>({origin:'https://example.com'}),websitePriceId:()=>''}));
import {selectWebsiteMobilePlatform,websiteSubscriptionPortal} from '../src/providers/stripe/website-commerce.js';
const user={uid:'buyer',email:'buyer@example.com',email_verified:true} as DecodedIdToken;
function fixture(){
 const order:any={claimedByUid:'buyer',request:{offer:'premium'}};
 const grant:any={uid:'buyer',product:'premium_lifetime_pass',state:'active',metadata:{stripeCheckoutSessionId:'cs_live_order',mobileSelectionPending:true}};
 const refs:any={order:{kind:'order'},grant:{kind:'grant'},audit:{kind:'audit'}};
 const db:any={collection:(name:string)=>({doc:()=>name==='websiteOrders'?refs.order:refs.audit,where:()=>({kind:'query'})}),runTransaction:async(fn:any)=>fn({
  get:async(ref:any)=>ref.kind==='order'?{exists:true,data:()=>order}:{docs:[{ref:refs.grant,data:()=>grant}]},
  update:(ref:any,data:any)=>Object.assign(ref.kind==='order'?order:grant,data),set:vi.fn()
 })};
 const recomputeEntitlements=vi.fn(),uidForProviderSubscription=vi.fn().mockResolvedValue('buyer');
 const store={firestore:()=>db,recomputeEntitlements,uidForProviderSubscription} as unknown as EntitlementStore;
 return {store,order,grant,recomputeEntitlements,uidForProviderSubscription};
}
beforeEach(()=>vi.clearAllMocks());
describe('Premium first mobile selection',()=>{
 it('selects once, recomputes access, and permits identical retries',async()=>{
  const f=fixture();await selectWebsiteMobilePlatform(f.store,user,'cs_live_order','ios');
  expect(f.grant.metadata).toMatchObject({primaryMobilePlatform:'ios',mobileSelectionPending:false});
  expect(f.order.selectedMobilePlatform).toBe('ios');expect(f.recomputeEntitlements).toHaveBeenCalled();
  await expect(selectWebsiteMobilePlatform(f.store,user,'cs_live_order','ios')).resolves.toEqual({mobilePlatform:'ios'});
  await expect(selectWebsiteMobilePlatform(f.store,user,'cs_live_order','android')).rejects.toThrow(/already been selected/);
 });
 it('rejects other users, inactive purchases, nonpremium orders and unverified email',async()=>{
  const f=fixture();f.order.claimedByUid='someone_else';await expect(selectWebsiteMobilePlatform(f.store,user,'cs_live_order','ios')).rejects.toThrow(/not found/);
  f.order.claimedByUid='buyer';f.grant.state='refunded';await expect(selectWebsiteMobilePlatform(f.store,user,'cs_live_order','ios')).rejects.toThrow(/not active/);
  f.grant.state='active';f.order.request.offer='mobile_monthly';await expect(selectWebsiteMobilePlatform(f.store,user,'cs_live_order','ios')).rejects.toThrow(/Premium/);
  await expect(selectWebsiteMobilePlatform(f.store,{...user,email_verified:false},'cs_live_order','ios')).rejects.toThrow();
 });
});
describe('Website subscription cancellation portal',()=>{
 it('creates a cancellation-enabled period-end portal without cancelling immediately',async()=>{
  const f=fixture();api.subscriptions.retrieve.mockResolvedValue({customer:'cus_buyer'});api.subscriptions.list.mockResolvedValue({has_more:false,data:[{id:'sub_buyer'}]});
  api.billingPortal.configurations.list.mockResolvedValue({data:[]});api.billingPortal.configurations.create.mockResolvedValue({id:'bpc_cancel'});api.billingPortal.sessions.create.mockResolvedValue({url:'https://billing.stripe.com/test'});
  await expect(websiteSubscriptionPortal(f.store,user,'sub_buyer')).resolves.toContain('billing.stripe.com');
  expect(api.billingPortal.configurations.create).toHaveBeenCalledWith(expect.objectContaining({features:expect.objectContaining({subscription_cancel:{enabled:true,mode:'at_period_end'}})}),expect.anything());
  expect(api.billingPortal.sessions.create).toHaveBeenCalledWith(expect.objectContaining({configuration:'bpc_cancel',customer:'cus_buyer'}));
 });
 it('refuses a portal which could expose another account subscription',async()=>{
  const f=fixture();f.uidForProviderSubscription.mockResolvedValueOnce('buyer').mockResolvedValue('someone_else');
  api.subscriptions.retrieve.mockResolvedValue({customer:'cus_shared'});api.subscriptions.list.mockResolvedValue({has_more:false,data:[{id:'sub_other'}]});
  await expect(websiteSubscriptionPortal(f.store,user,'sub_buyer')).rejects.toThrow(/ownership/);
  expect(api.billingPortal.sessions.create).not.toHaveBeenCalled();
 });
});
