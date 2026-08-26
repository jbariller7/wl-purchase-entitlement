import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvironmentForTests } from "../src/config/env.js";
import type { EffectiveEntitlements, LedgerGrant } from "../src/domain/model.js";
import type { EntitlementStore } from "../src/infrastructure/entitlement-store.js";
import { sha256 } from "../src/infrastructure/ids.js";

const playApi = vi.hoisted(() => ({
  getSubscription: vi.fn(),
  acknowledgeSubscription: vi.fn()
}));

vi.mock("googleapis", () => ({
  google: {
    auth: { GoogleAuth: class GoogleAuth {} },
    androidpublisher: () => ({
      purchases: {
        subscriptionsv2: { get: playApi.getSubscription },
        subscriptions: { acknowledge: playApi.acknowledgeSubscription },
        productsv2: { getproductpurchasev2: vi.fn() },
        products: { acknowledge: vi.fn() }
      }
    })
  }
}));

import { syncGooglePlaySubscription } from "../src/providers/google-play/service.js";

const original = { ...process.env };
const testPrivateKey = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({
  type: "pkcs8",
  format: "pem"
}).toString();
const expiredToken = "expired-play-purchase-token";
const newToken = "new-play-purchase-token";
const expiredTokenId = `play_${sha256(expiredToken)}`;
const newTokenId = `play_${sha256(newToken)}`;

function encryptionRing(): string {
  return JSON.stringify({
    current: "test-v1",
    keys: { "test-v1": Buffer.alloc(32, 7).toString("base64") }
  });
}

function playStore(input: { deleted?: boolean } = {}) {
  const grants: LedgerGrant[] = [];
  const store = {
    uidForStoreAccountToken: vi.fn().mockResolvedValue(undefined),
    uidForProviderTransaction: vi.fn().mockImplementation(
      async (_provider: string, transactionId: string) => input.deleted && transactionId === newTokenId
        ? "deleted_uid_hash"
        : undefined
    ),
    uidForProviderTransactionForAttribution: vi.fn().mockResolvedValue(undefined),
    uidForProviderSubscriptionForAttribution: vi.fn().mockImplementation(
      async (_provider: string, subscriptionId: string) => !input.deleted && subscriptionId === expiredTokenId
        ? "returning-player"
        : undefined
    ),
    upsertGrant: vi.fn(async (grant: LedgerGrant) => { grants.push(grant); }),
    saveGooglePlaySubscriptionToken: vi.fn(),
    storeAccountToken: vi.fn().mockResolvedValue("current-wonderlang-account-token"),
    revokeByProviderTransaction: vi.fn(),
    deleteGooglePlaySubscriptionToken: vi.fn(),
    effectiveEntitlements: vi.fn().mockResolvedValue({ uid: input.deleted ? "deleted_uid_hash" : "returning-player" } as EffectiveEntitlements)
  } as unknown as EntitlementStore;
  return { store, grants };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(process.env, {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "play-test@example.iam.gserviceaccount.com",
    GOOGLE_PRIVATE_KEY: testPrivateKey,
    GOOGLE_PLAY_PACKAGE_NAME: "com.wonderlang.app",
    GOOGLE_PLAY_MONTHLY_PRODUCT_ID: "wonderlangmonthly",
    GOOGLE_PLAY_POLYGLOT_PRODUCT_ID: "wonderlangfull",
    GOOGLE_PLAY_RTDN_AUDIENCE: "https://wl-purchase-entitlement.netlify.app/webhooks/google-play",
    GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL: "rtdn-test@example.iam.gserviceaccount.com",
    PROVIDER_TOKEN_ENCRYPTION_KEYS: encryptionRing()
  });
  resetEnvironmentForTests();
  playApi.getSubscription.mockResolvedValue({
    data: {
      lineItems: [{
        productId: "wonderlangmonthly",
        expiryTime: "2026-09-26T00:00:00.000Z",
        autoRenewingPlan: { autoRenewEnabled: true },
        latestSuccessfulOrderId: "GPA.resubscription-order"
      }],
      startTime: "2026-08-26T00:00:00.000Z",
      subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
      acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
      outOfAppPurchaseContext: {
        expiredPurchaseToken: expiredToken
      }
    }
  });
  playApi.acknowledgeSubscription.mockResolvedValue({ data: {} });
});

afterEach(() => {
  process.env = { ...original };
  resetEnvironmentForTests();
});

describe("Google Play subscriptions-center resubscriptions", () => {
  it("recovers the prior WonderLang owner, persists the new token, and acknowledges with the stable account token", async () => {
    const { store, grants } = playStore();
    await syncGooglePlaySubscription({
      store,
      purchaseToken: newToken,
      eventId: "play-out-of-app-resubscription",
      eventCreated: 1_787_697_600
    });

    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      uid: "returning-player",
      providerTransactionId: newTokenId,
      providerSubscriptionId: newTokenId,
      product: "mobile_full_monthly",
      state: "active",
      metadata: {
        outOfAppResubscription: true,
        attributionVerified: true
      }
    });
    expect(store.saveGooglePlaySubscriptionToken).toHaveBeenCalledWith({
      uid: "returning-player",
      providerSubscriptionId: newTokenId,
      purchaseToken: newToken,
      now: new Date(1_787_697_600_000)
    });
    expect(store.storeAccountToken).toHaveBeenCalledWith(
      "returning-player",
      new Date(1_787_697_600_000)
    );
    expect(playApi.acknowledgeSubscription).toHaveBeenCalledWith({
      packageName: "com.wonderlang.app",
      subscriptionId: "wonderlangmonthly",
      token: newToken,
      requestBody: {
        externalAccountIds: { obfuscatedAccountId: "current-wonderlang-account-token" }
      }
    });
  });

  it("retains a deleted account's lifecycle audit but does not bind or acknowledge a new purchase", async () => {
    const { store, grants } = playStore({ deleted: true });
    await syncGooglePlaySubscription({
      store,
      purchaseToken: newToken,
      eventId: "play-out-of-app-after-deletion",
      eventCreated: 1_787_697_601
    });

    expect(grants[0]).toMatchObject({
      uid: "deleted_uid_hash",
      metadata: {
        outOfAppResubscription: true,
        attributionVerified: false
      }
    });
    expect(store.storeAccountToken).not.toHaveBeenCalled();
    expect(playApi.acknowledgeSubscription).not.toHaveBeenCalled();
  });
});
