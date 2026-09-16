import {beforeEach,it,expect,vi} from 'vitest';
import type {Firestore} from 'firebase-admin/firestore';
const api=vi.hoisted(()=>({checkout:{sessions:{retrieve:vi.fn()}},invoices:{list:vi.fn()},invoicePayments:{list:vi.fn()},paymentIntents:{retrieve:vi.fn()}}));
vi.mock('../src/providers/stripe/website-config.js',()=>({websiteStripeClient:()=>api}));
import {websitePaymentsForUid,ownedWebsitePayment} from '../src/providers/stripe/website-admin-payments.js';
const query=vi.fn();
const db={collection:()=>({where:query})} as unknown as Firestore;
beforeEach(()=>{vi.clearAllMocks();query.mockReturnValue({get:async()=>({empty:false,docs:[{id:'cs_order'}]})});});
it('lists only payment intents from the UID-owned registered checkout',async()=>{
 api.checkout.sessions.retrieve.mockResolvedValue({livemode:true,metadata:{wl_checkout_flow:'website-session-v1'},payment_intent:'pi_owned'});
 api.paymentIntents.retrieve.mockResolvedValue({id:'pi_owned',livemode:true});
 expect(await websitePaymentsForUid(db,'buyer')).toEqual([{id:'pi_owned',livemode:true}]);
 expect(query).toHaveBeenCalledWith('claimedByUid','==','buyer');
 await expect(ownedWebsitePayment(db,'buyer','pi_other')).rejects.toThrow(/does not belong/);
});
it('includes recurring invoice payments using their subscription identity',async()=>{
 api.checkout.sessions.retrieve.mockResolvedValue({livemode:true,metadata:{wl_checkout_flow:'website-session-v1'},subscription:'sub_owned'});
 api.invoices.list.mockReturnValue([{id:'in_paid'}]);api.invoicePayments.list.mockReturnValue([{payment:{payment_intent:'pi_renewal'}}]);
 api.paymentIntents.retrieve.mockResolvedValue({id:'pi_renewal',livemode:true});
 expect(await websitePaymentsForUid(db,'buyer')).toEqual([{id:'pi_renewal',livemode:true}]);
 expect(api.invoices.list).toHaveBeenCalledWith({subscription:'sub_owned',limit:100});
});
it('rejects a checkout that is not a live registered website flow',async()=>{
 api.checkout.sessions.retrieve.mockResolvedValue({livemode:false,metadata:{wl_checkout_flow:'website-session-v1'}});
 await expect(websitePaymentsForUid(db,'buyer')).rejects.toThrow(/does not match/);expect(api.paymentIntents.retrieve).not.toHaveBeenCalled();
});
