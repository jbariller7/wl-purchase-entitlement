import {beforeEach,describe,it,expect,vi} from 'vitest';
import type {Firestore} from 'firebase-admin/firestore';
const mocks=vi.hoisted(()=>({owned:vi.fn(),refund:vi.fn(),audit:vi.fn(),legacy:vi.fn()}));
vi.mock('../src/providers/stripe/website-admin-payments.js',()=>({ownedWebsitePayment:mocks.owned}));
vi.mock('../src/providers/stripe/website-config.js',()=>({websiteStripeClient:()=>({refunds:{create:mocks.refund}})}));
vi.mock('../src/providers/stripe/client.js',()=>({stripeClient:mocks.legacy}));
vi.mock('../src/admin/audit.js',()=>({recordAdminAudit:mocks.audit}));
vi.mock('../src/config/env.js',()=>({deploymentControls:()=>({STRIPE_MUTATIONS_ENABLED:false})}));
import {AdminBillingService} from '../src/admin/billing-service.js';
function fixture(){
 const docs=new Map<string,any>();
 const db:any={collection:(name:string)=>({doc:(id:string)=>({id,get:async()=>({exists:docs.has(id),data:()=>docs.get(id)}),create:async(data:any)=>docs.set(id,data),update:async(data:any)=>docs.set(id,{...docs.get(id),...data})})})};
 db.runTransaction=async(fn:any)=>fn({get:(ref:any)=>ref.get(),update:(ref:any,data:any)=>ref.update(data)});
 return new AdminBillingService(db as Firestore);
}
const actor={uid:'admin',email:'admin@example.com'},now=new Date('2026-09-16T12:00:00Z');
beforeEach(()=>{vi.clearAllMocks();mocks.owned.mockResolvedValue({id:'pi_owned',livemode:true,customer:null,currency:'eur',latest_charge:{id:'ch_owned',amount:5999,amount_refunded:0}});mocks.refund.mockResolvedValue({id:'re_refund',amount:5999,currency:'eur',status:'succeeded'});});
describe('Admin live website refunds',()=>{
 it('previews without moving money, commits through live Stripe, and retries once safely',async()=>{
  const service=fixture();const p=await service.previewRefund({actor,uid:'buyer',paymentIntentId:'pi_owned',websitePayment:true,reason:'requested_by_customer',note:'Customer requested refund',now});
  expect(p.confirmationPhrase).toBe('LIVE REFUND 59.99 EUR');expect(mocks.refund).not.toHaveBeenCalled();
  const input={actor,now,previewId:String(p.previewId),confirmationPhrase:String(p.confirmationPhrase)};
  await service.commitRefund(input);await service.commitRefund(input);
  expect(mocks.refund).toHaveBeenCalledTimes(1);expect(mocks.legacy).not.toHaveBeenCalled();expect(mocks.audit).toHaveBeenCalled();
  expect(mocks.owned).toHaveBeenCalledTimes(2);
 });
 it('rejects another administrator and an incorrect confirmation',async()=>{
  const service=fixture();const p=await service.previewRefund({actor,uid:'buyer',paymentIntentId:'pi_owned',websitePayment:true,reason:'duplicate',note:'Duplicate purchase reported',now});
  await expect(service.commitRefund({actor:{...actor,uid:'other'},now,previewId:String(p.previewId),confirmationPhrase:String(p.confirmationPhrase)})).rejects.toThrow(/another administrator/);
  await expect(service.commitRefund({actor,now,previewId:String(p.previewId),confirmationPhrase:'REFUND'})).rejects.toThrow(/does not match/);
  expect(mocks.refund).not.toHaveBeenCalled();
 });
 it('rejects an unowned payment and an excessive refund',async()=>{
  const service=fixture();const input={actor,uid:'buyer',paymentIntentId:'pi_owned',websitePayment:true,reason:'duplicate' as const,note:'Duplicate purchase reported',now};
  await expect(service.previewRefund({...input,amount:6000})).rejects.toThrow(/between/);
  mocks.owned.mockRejectedValue(new Error('not owned'));await expect(service.previewRefund(input)).rejects.toThrow(/not owned/);
  expect(mocks.refund).not.toHaveBeenCalled();
 });
});
