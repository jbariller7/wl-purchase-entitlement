import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvironmentForTests } from "../src/config/env.js";
import type { EffectiveEntitlements, LedgerGrant } from "../src/domain/model.js";
import type { EntitlementStore } from "../src/infrastructure/entitlement-store.js";

const playApi = vi.hoisted(() => ({
  getOrder: vi.fn(),
  getProduct: vi.fn(),
  acknowledgeProduct: vi.fn()
}));

vi.mock("googleapis", () => ({
  google: {
    auth: { GoogleAuth: class GoogleAuth {} },
    androidpublisher: () => ({
      orders: { get: playApi.getOrder },
      purchases: {
        subscriptionsv2: { get: vi.fn() },
        subscriptions: { acknowledge: vi.fn() },
        productsv2: { getproductpurchasev2: playApi.getProduct },
        products: { acknowledge: playApi.acknowledgeProduct }
      }
    })
  }
}));

import { syncGooglePlayOneTimeProduct, googlePlayOneTimeAdDetails } from "../src/providers/google-play/service.js";

const original = { ...process.env };
const uid = "android-player";
const purchaseToken = "verified-one-time-purchase-token";
const eventCreated = 1_787_500_800;
const testPrivateKey = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({
  type: "pkcs8",
  format: "pem"
}).toString();

function playStore() {
  const grants: LedgerGrant[] = [];
  const store = {
    uidForStoreAccountToken: vi.fn().mockResolvedValue(uid),
    uidForProviderTransaction: vi.fn().mockResolvedValue(undefined),
    uidForProviderTransactionForAttribution: vi.fn().mockResolvedValue(undefined),
    uidForProviderSubscriptionForAttribution: vi.fn().mockResolvedValue(undefined),
    upsertGrant: vi.fn(async (grant: LedgerGrant) => { grants.push(grant); }),
    effectiveEntitlements: vi.fn().mockResolvedValue({ uid } as EffectiveEntitlements)
  } as unknown as EntitlementStore;
  return { store, grants };
}

function productReceipt(input: {
  productId?: string;
  purchaseState?: string;
  completionTime?: string;
  acknowledgementState?: string;
} = {}) {
  return {
    data: {
      productLineItem: [{ productId: input.productId ?? "wonderlangfull" }],
      orderId: "GPA.1111-2222-3333-44444",
      obfuscatedExternalAccountId: "stable-wonderlang-account-token",
      purchaseStateContext: { purchaseState: input.purchaseState ?? "PURCHASED" },
      purchaseCompletionTime: input.completionTime ?? "2026-08-20T12:00:00.000Z",
      acknowledgementState: input.acknowledgementState ?? "ACKNOWLEDGEMENT_STATE_PENDING"
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(process.env, {
    GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL: "play-test@example.iam.gserviceaccount.com",
    GOOGLE_PLAY_PRIVATE_KEY: testPrivateKey,
    GOOGLE_PLAY_PACKAGE_NAME: "com.wonderlang.app",
    GOOGLE_PLAY_MONTHLY_PRODUCT_ID: "wonderlangmonthly",
    GOOGLE_PLAY_POLYGLOT_PRODUCT_ID: "wonderlangfull",
    GOOGLE_PLAY_RTDN_AUDIENCE: "https://wonderlang.app/webhooks/google-play",
    GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL: "rtdn-test@example.iam.gserviceaccount.com"
  });
  resetEnvironmentForTests();
  playApi.getProduct.mockResolvedValue(productReceipt());
  playApi.acknowledgeProduct.mockResolvedValue({ data: {} });
});

afterEach(() => {
  process.env = { ...original };
  resetEnvironmentForTests();
});

describe("Google Play one-time purchase verification", () => {
  it("reports the actual verified order total and rejects sandbox, pending, mismatched and old acquisitions", async () => {
    const now = new Date("2026-08-20T13:00:00Z");
    const store = { getGrant: vi.fn().mockResolvedValue({uid, state: "active"}) } as unknown as EntitlementStore;
    const order = {purchaseToken, state:"PROCESSED", total:{units:"18", nanos:250000000, currencyCode:"EUR"}};
    playApi.getOrder.mockResolvedValue({data:order});
    const read = () => googlePlayOneTimeAdDetails(store, uid, "wonderlangfull", purchaseToken, now);
    expect(await read()).toMatchObject({eventName:"Purchase", value:18.25, currency:"EUR"});
    playApi.getProduct.mockResolvedValueOnce({data:{...productReceipt().data,testPurchaseContext:{fopType:"TEST"}}});
    expect(await read()).toBeUndefined();
    playApi.getProduct.mockResolvedValueOnce(productReceipt({purchaseState:"PENDING"}));
    expect(await read()).toBeUndefined();
    playApi.getProduct.mockResolvedValueOnce(productReceipt({completionTime:"2025-01-01T00:00:00Z"}));
    expect(await read()).toBeUndefined();
    playApi.getOrder.mockResolvedValueOnce({data:{...order,purchaseToken:"another-token"}});
    expect(await read()).toBeUndefined();
    playApi.getOrder.mockResolvedValueOnce({data:{...order,state:"PENDING"}});
    expect(await read()).toBeUndefined();
    vi.mocked(store.getGrant).mockResolvedValueOnce({uid:"another-user",state:"active"} as NonNullable<Awaited<ReturnType<EntitlementStore["getGrant"]>>>);
    expect(await read()).toBeUndefined();
  });
  it("verifies Polyglot, records platform-scoped permanent access, then acknowledges", async () => {
    const { store, grants } = playStore();

    await syncGooglePlayOneTimeProduct({
      store,
      productId: "wonderlangfull",
      purchaseToken,
      authenticatedUid: uid,
      eventId: "app-claim:polyglot",
      eventCreated
    });

    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      uid,
      provider: "google_play",
      providerTransactionId: "GPA.1111-2222-3333-44444",
      product: "mobile_polyglot_permanent",
      state: "active",
      metadata: {
        productId: "wonderlangfull",
        attributionVerified: true
      }
    });
    expect(playApi.acknowledgeProduct).toHaveBeenCalledWith({
      packageName: "com.wonderlang.app",
      productId: "wonderlangfull",
      token: purchaseToken,
      requestBody: {}
    });
  });

  it("records a pending Polyglot purchase without granting or acknowledging it", async () => {
    playApi.getProduct.mockResolvedValueOnce(productReceipt({ purchaseState: "PENDING" }));
    const { store, grants } = playStore();

    await syncGooglePlayOneTimeProduct({
      store,
      productId: "wonderlangfull",
      purchaseToken,
      authenticatedUid: uid,
      eventId: "app-claim:pending",
      eventCreated
    });

    expect(grants[0]).toMatchObject({ product: "mobile_polyglot_permanent", state: "pending" });
    expect(playApi.acknowledgeProduct).not.toHaveBeenCalled();
  });

  it("keeps an historical chapter grant and adds the promised permanent-full migration", async () => {
    playApi.getProduct.mockResolvedValueOnce(productReceipt({
      productId: "wonderlangch1",
      completionTime: "2026-08-01T12:00:00.000Z"
    }));
    const { store, grants } = playStore();

    await syncGooglePlayOneTimeProduct({
      store,
      productId: "wonderlangch1",
      purchaseToken,
      authenticatedUid: uid,
      eventId: "app-claim:historical-chapter",
      eventCreated
    });

    expect(grants).toHaveLength(2);
    expect(grants[0]).toMatchObject({ product: "legacy_chapter_1", state: "active" });
    expect(grants[1]).toMatchObject({
      providerTransactionId: "chapter-full-upgrade:GPA.1111-2222-3333-44444",
      product: "mobile_polyglot_permanent",
      state: "active",
      metadata: { migration: "historical_chapter_to_polyglot_permanent" }
    });
  });

  it("rejects a receipt whose Play product does not match the requested SKU", async () => {
    playApi.getProduct.mockResolvedValueOnce(productReceipt({ productId: "wonderlangch1" }));
    const { store, grants } = playStore();

    await expect(syncGooglePlayOneTimeProduct({
      store,
      productId: "wonderlangfull",
      purchaseToken,
      authenticatedUid: uid,
      eventId: "app-claim:mismatch",
      eventCreated
    })).rejects.toMatchObject({ status: 403 });

    expect(grants).toEqual([]);
    expect(playApi.acknowledgeProduct).not.toHaveBeenCalled();
  });
});
