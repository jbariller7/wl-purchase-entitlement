import {describe, it, expect, vi, beforeEach} from 'vitest';
import type {Firestore} from 'firebase-admin/firestore';
import {stableDocumentId} from '../src/infrastructure/ids.js';
const mocks = vi.hoisted(() => ({retrieve: vi.fn(), delivery: vi.fn()}));
vi.mock('../src/providers/stripe/website-config.js', () => ({websiteStripeClient: () => ({checkout: {sessions: {retrieve: mocks.retrieve}}})}));
vi.mock('../src/legacy/website-delivery.js', () => ({websiteDelivery: mocks.delivery}));
import {purchaseDetails} from '../src/admin/purchase-details.js';
const id = 'cs_live_paid';
const job = stableDocumentId('purchase_confirmation', `checkout:${id}`);
function db(records: Record<string, unknown>) {
  return {collection: (name: string) => ({doc: (key: string) => ({get: async () => ({data: () => records[`${name}/${key}`]})})})} as unknown as Firestore;
}
beforeEach(() => {vi.clearAllMocks(); mocks.retrieve.mockResolvedValue({amount_total: 7559, currency: 'brl', payment_status: 'paid', payment_intent: 'pi_paid'});});
describe('admin purchase inspection without an account', () => {
  it('joins the exact order, key and email receipt without exposing checkout secrets', async () => {
    const result = await purchaseDetails(db({
      [`websiteOrders/${id}`]: {buyerEmail: 'buyer@example.com', request: {offer:'polyglot', delivery:'steam'}, sourceEventCreated:1795100000, claimHash:'SECRET'},
      [`legacyFulfillments/${id}`]: {keys:[{key:'ASSIGNED-KEY'}], createdAt:'2026-11-19T17:40:29Z'},
      [`orderEmailDeliveries/${job}`]: {state:'sent', sentAt:'2026-11-19T17:41:08Z', messageId:'message', locale:'pt-PT'},
      [`outbox/${job}`]: {state:'complete', attemptCount:1, payload:{secret:'SECRET'}}
    }), id);
    expect(result).toMatchObject({product:'Polyglot — PC/Mac', claimedByUid:null, fulfillment:{keys:['ASSIGNED-KEY']}, email:{state:'sent', attempts:1}, payment:{amount:7559, currency:'brl'}});
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(mocks.delivery).not.toHaveBeenCalled();
  });
  it('preserves recorded email evidence when Stripe is unavailable and does not invent delivery', async () => {
    mocks.retrieve.mockRejectedValue(new Error('private provider error'));
    const result = await purchaseDetails(db({[`websiteOrders/${id}`]: {buyerEmail:'buyer@example.com', request:{offer:'polyglot'}}}), id);
    expect(result.payment).toBeNull();
    expect(result.email.state).toBe('not_recorded');
    expect(result.fulfillment.keys).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('private provider error');
  });
  it('rejects a nonexistent order', async () => {
    await expect(purchaseDetails(db({}), id)).rejects.toThrow('Website purchase not found');
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });
});
