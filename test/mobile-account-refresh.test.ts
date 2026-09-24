import {beforeEach, expect, it, vi} from 'vitest';
const m = vi.hoisted(() => ({identity: {uid: 'mobile', email: 'buyer@example.com', email_verified: true} as any, claim: vi.fn(), effective: vi.fn(), imports: vi.fn()}));
vi.mock('../src/http/auth.js', async original => ({...await original<any>(), requireUser: async () => m.identity}));
vi.mock('../src/http/app-check.js', () => ({requireAppCheck: vi.fn()}));
vi.mock('../src/http/rate-limit.js', () => ({consumeRateLimit: vi.fn()}));
vi.mock('../src/device-sign-in/service.js', () => ({requireCurrentDeviceSessionGeneration: vi.fn()}));
vi.mock('../src/admin/reviewer-accounts.js', () => ({ReviewerAccounts: class {recordLogin = vi.fn();}}));
vi.mock('../src/admin/import-service.js', () => ({AdminImportService: class {claimPendingForVerifiedUser = m.imports;}}));
vi.mock('../src/premium/second-platform-request-service.js', () => ({SecondPlatformRequestService: class {get = async () => null;}}));
vi.mock('../src/providers/stripe/website-commerce.js', () => ({claimMatchingWebsitePurchases: m.claim}));
vi.mock('../src/infrastructure/firebase.js', () => ({
  firebaseAppCheck: () => ({}), firebaseAuth: () => ({getUser: async () => ({providerData: []})}), firebaseStorage: vi.fn(),
  firestore: () => ({collection: () => ({doc: () => ({collection: () => ({get: async () => ({docs: []})})})})})
}));
vi.mock('../src/infrastructure/entitlement-store.js', () => ({EntitlementStore: class {
  effectiveEntitlements = m.effective;
  legacyDiscountClaim = async () => null;
  grantsForUid = async () => [];
  stripeCustomerId = async () => null;
}}));
import {lambdaHandler} from '../netlify/functions/api.js';
const refresh = async () => await lambdaHandler({path: '/api/v1/me', httpMethod: 'GET', headers: {}} as any, {} as any) as any;
beforeEach(() => {
  vi.clearAllMocks();
  m.identity = {uid: 'mobile', email: 'buyer@example.com', email_verified: true};
  m.claim.mockResolvedValue(undefined);
  m.effective.mockResolvedValue({mobilePlatforms: [], cloudSave: false});
});
it('returns newly claimed access on the first mobile account refresh', async () => {
  m.claim.mockImplementation(async () => {m.effective.mockResolvedValue({mobilePlatforms: ['android'], cloudSave: false});});
  const response = await refresh();
  expect(response.statusCode).toBe(200);
  expect(m.claim).toHaveBeenCalledWith(expect.anything(), m.identity);
  expect(JSON.parse(response.body).entitlements.mobilePlatforms).toEqual(['android']);
});
it('allows unverified accounts to refresh without claiming email purchases', async () => {
  m.identity.email_verified = false;
  expect((await refresh()).statusCode).toBe(200);
  expect(m.claim).not.toHaveBeenCalled();
});
