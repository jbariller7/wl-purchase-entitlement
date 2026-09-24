import {beforeEach, describe, expect, it, vi} from 'vitest';
const retrieve = vi.hoisted(() => vi.fn());
vi.mock('../src/providers/stripe/website-config.js', () => ({websiteStripeClient: () => ({checkout: {sessions: {retrieve}}})}));
import {claimMatchingWebsitePurchases} from '../src/providers/stripe/website-commerce.js';
import {projectEntitlements} from '../src/domain/entitlement-projector.js';

const user = {uid: 'mobile-user', email: 'Buyer@Example.com', email_verified: true} as any;
function fixture(offer = 'mobile_permanent', owner?: string) {
  const order: any = {buyerEmail: 'buyer@example.com', request: {offer, mobilePlatform: 'android'}, sourceEventId: 'evt_paid', sourceEventCreated: 1790239902, ...(owner ? {claimedByUid: owner} : {})};
  const grants: any[] = [];
  const doc = {id: 'cs_purchase', exists: true, data: () => order};
  const ref = {get: async () => doc};
  const where = vi.fn((field, _op, value) => ({limit: () => ({get: async () => ({docs: order[field] === value ? [doc] : []})})}));
  const db = {collection: () => ({where, doc: () => ref}), runTransaction: async (fn: any) => fn({get: () => ref.get(), update: (_ref: any, patch: any) => Object.assign(order, patch)})};
  const upsertGrant = vi.fn(async (grant: any) => {grants.push({...grant, id: 'grant_paid'});});
  const store = {firestore: () => db, grantsForUid: async () => grants, upsertGrant} as any;
  return {store, order, grants, where, upsertGrant};
}
beforeEach(() => {
  retrieve.mockReset();
  retrieve.mockResolvedValue({id: 'cs_purchase', payment_status: 'paid', payment_intent: {id: 'pi_paid', latest_charge: {refunded: false, disputed: false}}});
});
describe('mobile account refresh claims website purchases', () => {
  it('claims a verified email match and unlocks only the purchased platform; refresh does not duplicate it', async () => {
    const f = fixture();
    await claimMatchingWebsitePurchases(f.store, user);
    expect(f.where).toHaveBeenCalledWith('buyerEmail', '==', 'buyer@example.com');
    expect(f.order.claimedByUid).toBe(user.uid);
    const e = projectEntitlements(user.uid, f.grants, new Date('2026-09-24T12:00:00Z'), 0);
    expect(e.mobilePlatforms).toEqual(['android']);
    expect(e.cloudSave).toBe(false);
    await claimMatchingWebsitePurchases(f.store, user);
    expect(f.upsertGrant).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenCalledTimes(1);
  });
  it('claims an active monthly purchase with its original expiry', async () => {
    retrieve.mockResolvedValue({id: 'cs_purchase', payment_status: 'paid', subscription: {id: 'sub_paid', status: 'active', items: {data: [{current_period_end: 1792831902}]}}, payment_intent: null});
    const f = fixture('mobile_monthly');
    await claimMatchingWebsitePurchases(f.store, user);
    expect(f.grants[0]).toMatchObject({product: 'mobile_full_monthly', state: 'active', providerSubscriptionId: 'sub_paid', endsAt: new Date(1792831902000).toISOString()});
  });
  it('rejects unverified or missing email before querying orders', async () => {
    for (const identity of [{...user, email_verified: false}, {...user, email: undefined}]) {
      const f = fixture();
      await expect(claimMatchingWebsitePurchases(f.store, identity)).rejects.toThrow(/Verify/);
      expect(f.where).not.toHaveBeenCalled();
    }
  });
  it('does not take another account’s order or match a different email', async () => {
    for (const f of [fixture('mobile_permanent', 'other-user'), fixture()]) {
      const identity = f.order.claimedByUid ? user : {...user, email: 'different@example.com'};
      await claimMatchingWebsitePurchases(f.store, identity);
      expect(f.upsertGrant).not.toHaveBeenCalled();
    }
    expect(retrieve).not.toHaveBeenCalled();
  });
  it.each(['unpaid', 'refunded', 'disputed'])('does not unlock a %s purchase', async status => {
    retrieve.mockResolvedValue({id: 'cs_purchase', payment_status: status === 'unpaid' ? 'unpaid' : 'paid', payment_intent: {id: 'pi_paid', latest_charge: {refunded: status === 'refunded', disputed: status === 'disputed'}}});
    const f = fixture();
    await claimMatchingWebsitePurchases(f.store, user);
    expect(f.upsertGrant).not.toHaveBeenCalled();
    expect(f.order.claimedByUid).toBeUndefined();
  });
  it('retries an interrupted claim without swallowing infrastructure failures', async () => {
    const f = fixture('mobile_permanent', user.uid);
    retrieve.mockRejectedValueOnce(new Error('Temporary Stripe failure'));
    await expect(claimMatchingWebsitePurchases(f.store, user)).rejects.toThrow('Temporary Stripe failure');
    await claimMatchingWebsitePurchases(f.store, user);
    expect(f.upsertGrant).toHaveBeenCalledTimes(1);
  });
});
