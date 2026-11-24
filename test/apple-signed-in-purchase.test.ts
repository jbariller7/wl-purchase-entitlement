import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Environment, SignedDataVerifier, VerificationException, VerificationStatus } from "@apple/app-store-server-library";
import type { EntitlementStore } from "../src/infrastructure/entitlement-store.js";
import { resetEnvironmentForTests } from "../src/config/env.js";
import { claimAppleTransaction } from "../src/providers/apple/service.js";

import { rootCertificates } from "node:tls";

const original = { ...process.env };
const verify = vi.spyOn(SignedDataVerifier.prototype, "verifyAndDecodeTransaction");
const now = new Date();
const token = "11111111-aaaa-4bbb-8ccc-222222222222";
const store = {
  uidForStoreAccountToken: vi.fn(async () => "player"),
  uidForProviderTransaction: vi.fn(async () => undefined),
  uidForProviderSubscription: vi.fn(async () => undefined),
  upsertGrant: vi.fn(async () => true),
  effectiveEntitlements: vi.fn(async () => ({ uid: "player" }))
};
function claim(uid = "player") {
  return claimAppleTransaction({ store: store as unknown as EntitlementStore, authenticatedUid: uid, signedTransactionInfo: "test-receipt", now });
}
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(process.env, {
    APPLE_ENVIRONMENT: "Production", APPLE_APP_ID: "6780447024", APPLE_BUNDLE_ID: "com.wonderlang.app",
    APPLE_PRIVATE_KEY: "unused-in-unit-test", APPLE_KEY_ID: "test", APPLE_ISSUER_ID: "test",
    APPLE_ROOT_CA_G2_BASE64: Buffer.from(rootCertificates[0]!).toString("base64"),
    APPLE_ROOT_CA_G3_BASE64: Buffer.from(rootCertificates[1]!).toString("base64")
  });
  resetEnvironmentForTests();
});
afterEach(() => { process.env = { ...original }; resetEnvironmentForTests(); });
describe("signed-in purchase and restore", () => {
  for (const productId of ["wonderlangmonthly", "wonderlangfull"]) {
    const receipt = { productId, originalTransactionId: "original", transactionId: "purchase", signedDate: now.getTime(),
      expiresDate: now.getTime() + 60000, appAccountToken: token.toUpperCase() };
    it(`restores ${productId} to the same production grant`, async () => {
      verify.mockResolvedValue({ ...receipt, environment: Environment.PRODUCTION });
      await claim(); await claim();
      expect(store.upsertGrant).toHaveBeenCalledTimes(2);
      expect(store.upsertGrant.mock.calls[0]).toEqual(store.upsertGrant.mock.calls[1]);
      expect(store.uidForStoreAccountToken).toHaveBeenCalledWith(token);
    });
    it(`accepts verified sandbox purchase and restore of ${productId} with cloud-only access and no paid ownership`, async () => {
      for (let i = 0; i < 2; i++) {
        verify.mockRejectedValueOnce(new VerificationException(VerificationStatus.INVALID_ENVIRONMENT))
          .mockResolvedValueOnce({ ...receipt, environment: Environment.SANDBOX });
        await claim();
      }
      expect(store.upsertGrant).toHaveBeenCalledTimes(2);
      expect(store.upsertGrant).toHaveBeenCalledWith(expect.objectContaining({product:"apple_sandbox_cloud", providerTransactionId:"sandbox-cloud:original", state:"active"}), expect.any(Object));
      expect(store.effectiveEntitlements).toHaveBeenCalledTimes(2);
    });
  }
  it("propagates signature failures and rejects a sandbox receipt linked to a different player", async () => {
    verify.mockRejectedValueOnce(new VerificationException(VerificationStatus.INVALID_CERTIFICATE));
    await expect(claim()).rejects.toMatchObject({ status: VerificationStatus.INVALID_CERTIFICATE });
    expect(verify).toHaveBeenCalledTimes(1);
    verify.mockRejectedValueOnce(new VerificationException(VerificationStatus.INVALID_ENVIRONMENT))
      .mockResolvedValueOnce({ environment: Environment.SANDBOX, productId: "wonderlangfull", appAccountToken: token });
    await expect(claim("other")).rejects.toMatchObject({ status: 403 });
    expect(store.upsertGrant).not.toHaveBeenCalled();
  });
});

it.each(["wonderlangmonthly", "wonderlangfull"])("sandbox %s revocation and expiry cannot retain cloud", async productId => {
  for(const revoked of [false,true]) {
    verify.mockResolvedValue({environment:Environment.SANDBOX, productId, originalTransactionId:"cloud-check",
      transactionId:"latest", signedDate:now.getTime()-31*86400000,
      expiresDate:now.getTime()-1000, ...(revoked ? {revocationDate:now.getTime()-500} : {})});
    await claim();
    expect(store.upsertGrant).toHaveBeenLastCalledWith(expect.objectContaining({product:"apple_sandbox_cloud",
      providerTransactionId:"sandbox-cloud:cloud-check",state:revoked?"revoked":"expired"}),expect.any(Object));
  }
});
it("rejects a sandbox cloud receipt already linked to another account", async () => {
  store.uidForProviderTransaction.mockResolvedValueOnce("other" as never);
  verify.mockResolvedValue({environment:Environment.SANDBOX,productId:"wonderlangfull",
    originalTransactionId:"claimed", transactionId:"claimed-new",signedDate:now.getTime()});
  await expect(claim()).rejects.toMatchObject({status:403});
  expect(store.upsertGrant).not.toHaveBeenCalled();
});
