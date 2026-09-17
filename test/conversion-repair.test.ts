import {afterEach,expect,it,vi} from 'vitest';
import {playSubscriptionAdEvent} from '../src/domain/play-ad-event.js';
import {stripeInvoiceAdDecision} from '../src/domain/ad-policy.js';
import {resetEnvironmentForTests} from '../src/config/env.js';
const mocked=vi.hoisted(()=>({lease:vi.fn().mockResolvedValue([]),db:vi.fn()}));
vi.mock('../src/infrastructure/entitlement-store.js',()=>({EntitlementStore:class {leaseOutboxJobs=mocked.lease}}));
vi.mock('../src/infrastructure/firebase.js',()=>({firestore:mocked.db,firebaseAuth:vi.fn(),firebaseStorage:vi.fn()}));
import {runOutboxWorker} from '../src/outbox/worker.js';
const original={...process.env};
afterEach(()=>{process.env={...original};resetEnvironmentForTests();vi.clearAllMocks()});
it('leases only advertising jobs while all other outbox processing remains disabled',async()=>{
 Object.assign(process.env,{AD_CONVERSIONS_ENABLED:'true',OUTBOX_PROCESSING_ENABLED:'false'});resetEnvironmentForTests();
 expect(await runOutboxWorker()).toEqual({processed:0,failed:0});
 expect(mocked.lease).toHaveBeenCalledWith(expect.any(String),expect.any(Date),20,['meta_conversion','tiktok_conversion']);
});
it('includes first paid post-trial invoice but excludes a renewal and zero-value invoice',()=>{
 expect(stripeInvoiceAdDecision({paid:true,amountPaid:699,billingReason:'subscription_cycle',firstPaidInvoice:true}).send).toBe(true);
 expect(stripeInvoiceAdDecision({paid:true,amountPaid:699,billingReason:'subscription_cycle',firstPaidInvoice:false}).send).toBe(false);
 expect(stripeInvoiceAdDecision({paid:true,amountPaid:0,billingReason:'subscription_create'}).send).toBe(false);
});
const base={testPurchase:false,active:true,trial:false,subscriptionId:'play_hash',startedAt:'2026-09-14T12:00:00Z',now:new Date('2026-09-17T13:00:00Z'),currency:'EUR'};
const order={id:'order',createdAt:'2026-09-17T12:00:00Z',state:'PROCESSED',value:6.99,currency:'EUR'};
it('keeps free trials at zero and uses verified payment amount for paid subscriptions',()=>{
 expect(playSubscriptionAdEvent({...base,trial:true})).toMatchObject({eventName:'StartTrial',value:0,currency:'EUR'});
 expect(playSubscriptionAdEvent({...base,order})).toMatchObject({eventName:'Subscribe',value:6.99,currency:'EUR'});
});
it('does not count sandbox, restored old subscriptions, pending orders, or invalid money as acquisitions',()=>{
 expect(playSubscriptionAdEvent({...base,testPurchase:true,order})).toBeUndefined();
 expect(playSubscriptionAdEvent({...base,active:false,order})).toBeUndefined();
 expect(playSubscriptionAdEvent({...base,startedAt:'2025-01-01T00:00:00Z',order})).toBeUndefined();
 expect(playSubscriptionAdEvent({...base,order:{...order,state:'PENDING'}})).toBeUndefined();
 expect(playSubscriptionAdEvent({...base,order:{...order,value:0}})).toBeUndefined();
});
