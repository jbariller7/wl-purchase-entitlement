import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Status,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload
} from "@apple/app-store-server-library";
import { resetEnvironmentForTests } from "../src/config/env.js";
import type { EntitlementStore } from "../src/infrastructure/entitlement-store.js";
import type { EffectiveEntitlements, LedgerGrant } from "../src/domain/model.js";

const serviceMocks = vi.hoisted(() => ({
  subscription: vi.fn(),
  oneTime: vi.fn()
}));

vi.mock("../src/providers/google-play/service.js", async () => {
  const actual = await vi.importActual<typeof import("../src/providers/google-play/service.js")>("../src/providers/google-play/service.js");
  return {
    ...actual,
    syncGooglePlaySubscription: serviceMocks.subscription,
    syncGooglePlayOneTimeProduct: serviceMocks.oneTime
  };
});

import {
  appleTransactionSignedAtSeconds,
  canonicalAppleTransactionId,
  normalizeAppleSubscriptionState,
  processAppleNotification
} from "../src/providers/apple/service.js";
import { normalizeGooglePlaySubscriptionState } from "../src/providers/google-play/service.js";
import { parseRtdn, processRtdn } from "../src/providers/google-play/rtdn.js";

const original = { ...process.env };
const eventCreated = 1_787_654_321;

function push(notification: Record<string, unknown>, messageId = "play-message-1") {
  return {
    message: {
      messageId,
      data: Buffer.from(JSON.stringify({
        packageName: "com.wonderlang.app",
        eventTimeMillis: String(eventCreated * 1000),
        ...notification
      })).toString("base64")
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(process.env, {
    GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL: "play-test@example.iam.gserviceaccount.com",
    GOOGLE_PLAY_PRIVATE_KEY: "test-private-key",
    GOOGLE_PLAY_PACKAGE_NAME: "com.wonderlang.app",
    GOOGLE_PLAY_MONTHLY_PRODUCT_ID: "wonderlangmonthly",
    GOOGLE_PLAY_POLYGLOT_PRODUCT_ID: "wonderlangfull",
    GOOGLE_PLAY_RTDN_AUDIENCE: "https://wl-purchase-entitlement.netlify.app/webhooks/google-play",
    GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL: "rtdn-test@example.iam.gserviceaccount.com",
    APPLE_BUNDLE_ID: "com.wonderlang.app",
    APPLE_MONTHLY_PRODUCT_ID: "wonderlangmonthly",
    APPLE_POLYGLOT_PRODUCT_ID: "wonderlangfull",
    APPLE_ISSUER_ID: "test-issuer",
    APPLE_KEY_ID: "TESTKEY123",
    APPLE_PRIVATE_KEY: "test-private-key",
    APPLE_ROOT_CA_G2_BASE64: "dGVzdA==",
    APPLE_ROOT_CA_G3_BASE64: "dGVzdA==",
    APPLE_ENVIRONMENT: "Sandbox"
  });
  resetEnvironmentForTests();
});

afterEach(() => {
  process.env = { ...original };
  resetEnvironmentForTests();
});

describe("provider subscription state normalization", () => {
  it.each([
    ["SUBSCRIPTION_STATE_ACTIVE", "active"],
    ["SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "grace"],
    ["SUBSCRIPTION_STATE_PENDING", "pending"],
    ["SUBSCRIPTION_STATE_CANCELED", "active"],
    ["SUBSCRIPTION_STATE_PAUSED", "expired"],
    [undefined, "expired"]
  ])("maps Google Play %s to %s", (providerState, ledgerState) => {
    expect(normalizeGooglePlaySubscriptionState(providerState)).toBe(ledgerState);
  });

  it("maps Apple active, grace, expired, retry, and revoked states", () => {
    const now = new Date("2026-08-25T12:00:00.000Z");
    const future = now.getTime() + 86_400_000;
    const past = now.getTime() - 86_400_000;
    const transaction = { expiresDate: future } as JWSTransactionDecodedPayload;

    expect(normalizeAppleSubscriptionState({ transaction, now })).toEqual({ state: "active" });
    expect(normalizeAppleSubscriptionState({
      status: Status.BILLING_GRACE_PERIOD,
      transaction,
      renewal: { gracePeriodExpiresDate: future } as JWSRenewalInfoDecodedPayload,
      now
    })).toEqual({ state: "grace", graceEndsAt: new Date(future).toISOString() });
    expect(normalizeAppleSubscriptionState({ status: Status.EXPIRED, transaction, now })).toEqual({ state: "expired" });
    expect(normalizeAppleSubscriptionState({ status: Status.BILLING_RETRY, transaction, now })).toEqual({ state: "expired" });
    expect(normalizeAppleSubscriptionState({
      status: Status.ACTIVE,
      transaction: { expiresDate: past } as JWSTransactionDecodedPayload,
      now
    })).toEqual({ state: "expired" });
    expect(normalizeAppleSubscriptionState({
      status: Status.ACTIVE,
      transaction: { revocationDate: past } as JWSTransactionDecodedPayload,
      now
    })).toEqual({ state: "revoked" });
    expect(normalizeAppleSubscriptionState({ status: Status.REVOKED, transaction, now })).toEqual({ state: "revoked" });
  });
});

function appleStore(grants: LedgerGrant[]) {
  return {
    uidForStoreAccountToken: vi.fn().mockResolvedValue("apple-user"),
    uidForProviderTransaction: vi.fn().mockResolvedValue(undefined),
    uidForProviderSubscription: vi.fn().mockResolvedValue(undefined),
    upsertGrant: vi.fn(async (grant: LedgerGrant) => { grants.push(grant); }),
    effectiveEntitlements: vi.fn().mockResolvedValue({ uid: "apple-user" } as EffectiveEntitlements)
  } as unknown as EntitlementStore;
}

describe("Apple verified notification routing", () => {
  it("uses the original transaction as the permanent ownership key across restores", () => {
    expect(canonicalAppleTransactionId({
      transactionId: "apple-restored-transaction-a",
      originalTransactionId: "apple-original-purchase"
    } as JWSTransactionDecodedPayload)).toBe("apple-original-purchase");
    expect(canonicalAppleTransactionId({
      transactionId: "apple-restored-transaction-b",
      originalTransactionId: "apple-original-purchase"
    } as JWSTransactionDecodedPayload)).toBe("apple-original-purchase");
    expect(() => canonicalAppleTransactionId({
      transactionId: "apple-restore-without-original"
    } as JWSTransactionDecodedPayload)).toThrow(/original transaction ID/i);
  });

  it("orders app claims by Apple's signed time and rejects an unordered JWS", () => {
    expect(appleTransactionSignedAtSeconds({ signedDate: 1_787_654_321_999 } as JWSTransactionDecodedPayload))
      .toBeCloseTo(1_787_654_321.999);
    expect(() => appleTransactionSignedAtSeconds({} as JWSTransactionDecodedPayload))
      .toThrow(/signed date/i);
  });

  it("creates an active Monthly grant from a verified subscription notification", async () => {
    const grants: LedgerGrant[] = [];
    const purchaseDate = Date.parse("2026-08-25T10:00:00.000Z");
    const expiresDate = Date.parse("2026-09-25T10:00:00.000Z");

    await processAppleNotification({
      store: appleStore(grants),
      verified: {
        notification: {
          notificationUUID: "apple-monthly-event",
          signedDate: Date.parse("2026-08-25T10:05:00.000Z"),
          data: { status: Status.ACTIVE }
        } as ResponseBodyV2DecodedPayload,
        transaction: {
          productId: "wonderlangmonthly",
          transactionId: "apple-latest-transaction",
          originalTransactionId: "apple-original-transaction",
          appAccountToken: "00000000-0000-4000-8000-000000000001",
          purchaseDate,
          originalPurchaseDate: purchaseDate,
          signedDate: Date.parse("2026-08-25T10:04:59.000Z"),
          expiresDate
        }
      }
    });

    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      uid: "apple-user",
      provider: "apple",
      providerTransactionId: "apple-original-transaction",
      providerSubscriptionId: "apple-original-transaction",
      product: "mobile_full_monthly",
      state: "active",
      startsAt: new Date(purchaseDate).toISOString(),
      currentPeriodEndsAt: new Date(expiresDate).toISOString(),
      endsAt: new Date(expiresDate).toISOString()
    });
  });

  it("records an old chapter purchase and the promised permanent Polyglot upgrade", async () => {
    const grants: LedgerGrant[] = [];
    const purchaseDate = Date.parse("2026-08-01T10:00:00.000Z");

    await processAppleNotification({
      store: appleStore(grants),
      verified: {
        notification: {
          notificationUUID: "apple-chapter-event",
          signedDate: Date.parse("2026-08-25T10:05:00.000Z")
        } as ResponseBodyV2DecodedPayload,
        transaction: {
          productId: "wonderlangch1",
          transactionId: "apple-chapter-transaction",
          originalTransactionId: "apple-chapter-original",
          appAccountToken: "00000000-0000-4000-8000-000000000002",
          purchaseDate,
          signedDate: Date.parse("2026-08-25T10:04:59.000Z")
        }
      }
    });

    expect(grants).toHaveLength(2);
    expect(grants[0]).toMatchObject({
      providerTransactionId: "apple-chapter-original",
      product: "legacy_chapter_1",
      state: "active"
    });
    expect(grants[1]).toMatchObject({
      providerTransactionId: "chapter-full-upgrade:apple-chapter-original",
      product: "mobile_polyglot_permanent",
      state: "active",
      metadata: {
        migration: "historical_chapter_to_polyglot_permanent",
        originalProduct: "legacy_chapter_1"
      }
    });
  });

  it("routes a tokenless non-consumable refund to the owner of the original Apple purchase", async () => {
    const grants: LedgerGrant[] = [];
    const originalPurchaseDate = Date.parse("2026-07-01T10:00:00.000Z");
    const revocationDate = Date.parse("2026-08-25T10:00:00.000Z");
    const store = {
      uidForStoreAccountToken: vi.fn().mockResolvedValue(undefined),
      uidForProviderTransaction: vi.fn().mockResolvedValue("original-owner"),
      uidForProviderSubscription: vi.fn().mockResolvedValue(undefined),
      upsertGrant: vi.fn(async (grant: LedgerGrant) => { grants.push(grant); }),
      effectiveEntitlements: vi.fn().mockResolvedValue({ uid: "original-owner" } as EffectiveEntitlements)
    } as unknown as EntitlementStore;

    await processAppleNotification({
      store,
      verified: {
        notification: {
          notificationUUID: "apple-polyglot-refund",
          signedDate: Date.parse("2026-08-25T10:05:00.000Z")
        } as ResponseBodyV2DecodedPayload,
        transaction: {
          productId: "wonderlangfull",
          transactionId: "apple-refund-transaction",
          originalTransactionId: "apple-original-purchase",
          originalPurchaseDate,
          purchaseDate: revocationDate,
          revocationDate,
          signedDate: Date.parse("2026-08-25T10:04:59.000Z")
        }
      }
    });

    expect(store.uidForProviderTransaction).toHaveBeenCalledWith("apple", "apple-original-purchase");
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      uid: "original-owner",
      providerTransactionId: "apple-original-purchase",
      product: "mobile_polyglot_permanent",
      state: "refunded",
      startsAt: new Date(originalPurchaseDate).toISOString(),
      endsAt: new Date(revocationDate).toISOString(),
      metadata: {
        originalTransactionId: "apple-original-purchase",
        latestTransactionId: "apple-refund-transaction"
      }
    });
  });

  it("rejects a claim when Apple's account token disagrees with the existing purchase owner", async () => {
    const upsertGrant = vi.fn();
    const store = {
      uidForStoreAccountToken: vi.fn().mockResolvedValue("token-owner"),
      uidForProviderTransaction: vi.fn().mockResolvedValue("ledger-owner"),
      uidForProviderSubscription: vi.fn().mockResolvedValue(undefined),
      upsertGrant,
      effectiveEntitlements: vi.fn()
    } as unknown as EntitlementStore;

    await expect(processAppleNotification({
      store,
      verified: {
        notification: {
          notificationUUID: "apple-account-mismatch",
          signedDate: Date.parse("2026-08-25T10:05:00.000Z")
        } as ResponseBodyV2DecodedPayload,
        transaction: {
          productId: "wonderlangfull",
          transactionId: "apple-restored-transaction",
          originalTransactionId: "apple-original-purchase",
          appAccountToken: "00000000-0000-4000-8000-000000000003",
          signedDate: Date.parse("2026-08-25T10:04:59.000Z")
        }
      }
    })).rejects.toThrow(/account identifiers disagree/i);
    expect(upsertGrant).not.toHaveBeenCalled();
  });
});

describe("Google Play RTDN routing", () => {
  it("parses and routes subscription notifications", async () => {
    const store = {} as EntitlementStore;
    const parsed = parseRtdn(push({
      subscriptionNotification: {
        notificationType: 2,
        purchaseToken: "subscription-token",
        subscriptionId: "wonderlangmonthly"
      }
    }));

    expect(parsed).toMatchObject({ messageId: "play-message-1", eventCreated });
    await processRtdn(store, parsed);
    expect(serviceMocks.subscription).toHaveBeenCalledWith({
      store,
      purchaseToken: "subscription-token",
      eventId: "play-message-1",
      eventCreated
    });
    expect(serviceMocks.oneTime).not.toHaveBeenCalled();
  });

  it("routes one-time Polyglot notifications", async () => {
    const store = {} as EntitlementStore;
    const parsed = parseRtdn(push({
      oneTimeProductNotification: {
        notificationType: 1,
        purchaseToken: "product-token",
        sku: "wonderlangfull"
      }
    }, "play-product-1"));

    await processRtdn(store, parsed);
    expect(serviceMocks.oneTime).toHaveBeenCalledWith({
      store,
      productId: "wonderlangfull",
      purchaseToken: "product-token",
      eventId: "play-product-1",
      eventCreated
    });
    expect(serviceMocks.subscription).not.toHaveBeenCalled();
  });

  it("revokes both a refunded purchase and its historical chapter upgrade", async () => {
    const revokeByProviderTransaction = vi.fn().mockResolvedValue(undefined);
    const store = { revokeByProviderTransaction } as unknown as EntitlementStore;
    const parsed = parseRtdn(push({
      voidedPurchaseNotification: { orderId: "GPA.1234-5678-9012-34567" }
    }, "play-refund-1"));

    await processRtdn(store, parsed);
    expect(revokeByProviderTransaction).toHaveBeenCalledTimes(2);
    expect(revokeByProviderTransaction.mock.calls.map(([call]) => call.providerTransactionId)).toEqual([
      "GPA.1234-5678-9012-34567",
      "chapter-full-upgrade:GPA.1234-5678-9012-34567"
    ]);
    expect(revokeByProviderTransaction.mock.calls.every(([call]) => call.state === "refunded")).toBe(true);
  });

  it("accepts a Google test notification without creating or revoking entitlements", async () => {
    const revokeByProviderTransaction = vi.fn();
    const store = { revokeByProviderTransaction } as unknown as EntitlementStore;
    const parsed = parseRtdn(push({ testNotification: { version: "1.0" } }, "play-test-1"));

    await expect(processRtdn(store, parsed)).resolves.toBeUndefined();
    expect(serviceMocks.subscription).not.toHaveBeenCalled();
    expect(serviceMocks.oneTime).not.toHaveBeenCalled();
    expect(revokeByProviderTransaction).not.toHaveBeenCalled();
  });

  it("rejects notifications for another Android package", () => {
    expect(() => parseRtdn({
      message: {
        messageId: "wrong-package",
        data: Buffer.from(JSON.stringify({
          packageName: "com.example.other",
          eventTimeMillis: String(eventCreated * 1000),
          testNotification: { version: "1.0" }
        })).toString("base64")
      }
    })).toThrow(/package name mismatch/i);
  });
});
