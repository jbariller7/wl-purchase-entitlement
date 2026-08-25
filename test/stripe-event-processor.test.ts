import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { resetEnvironmentForTests } from "../src/config/env.js";
import type { EntitlementStore } from "../src/infrastructure/entitlement-store.js";

const stripeMock = vi.hoisted(() => ({
  subscriptions: { retrieve: vi.fn() },
  charges: { retrieve: vi.fn() },
  customers: { retrieve: vi.fn() },
  checkout: { sessions: { list: vi.fn() } }
}));

vi.mock("../src/providers/stripe/client.js", () => ({
  stripeClient: () => stripeMock
}));

import { processStripeEvent } from "../src/providers/stripe/event-processor.js";

const original = { ...process.env };
const created = 1_787_659_200;

function stripeEvent(type: Stripe.Event.Type, object: object, id = `evt_${type.replace(/\W/g, "_")}`): Stripe.Event {
  return { id, type, created, data: { object } } as Stripe.Event;
}

function fakeStore() {
  return {
    firestore: vi.fn(),
    upsertGrant: vi.fn().mockResolvedValue(true),
    getGrant: vi.fn().mockResolvedValue(undefined),
    revokeByProviderTransaction: vi.fn().mockResolvedValue(true),
    uidForProviderSubscription: vi.fn().mockResolvedValue(undefined),
    uidForStripeCustomer: vi.fn().mockResolvedValue(undefined),
    linkCheckoutContextToSubscription: vi.fn().mockResolvedValue(undefined),
    checkoutContext: vi.fn().mockResolvedValue(undefined),
    subscriptionContext: vi.fn().mockResolvedValue(undefined),
    saveLegacyOrder: vi.fn().mockResolvedValue(undefined),
    enqueue: vi.fn().mockResolvedValue(undefined),
    redeemLegacyDiscount: vi.fn().mockResolvedValue(undefined),
    releaseLegacyDiscount: vi.fn().mockResolvedValue(undefined)
  };
}

function monthlySubscription(overrides: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: "sub_historical_monthly",
    object: "subscription",
    status: "active",
    created: created - 86_400,
    customer: "cus_monthly",
    cancel_at_period_end: false,
    canceled_at: null,
    trial_end: null,
    metadata: { wl_product: "mobile_full_monthly", wl_uid: "uid_monthly" },
    items: {
      data: [{ price: { id: "price_historical_monthly" }, current_period_end: created + 2_592_000 }]
    },
    ...overrides
  } as unknown as Stripe.Subscription;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(process.env, {
    APP_ENVIRONMENT: "test",
    AD_CONVERSIONS_ENABLED: "false",
    STRIPE_WEBHOOKS_ENABLED: "false",
    OUTBOX_PROCESSING_ENABLED: "false",
    LEGACY_FULFILLMENT_ENABLED: "false",
    SUBSCRIPTION_CANCELLATION_ENABLED: "false"
  });
  resetEnvironmentForTests();
});

afterEach(() => {
  process.env = { ...original };
  resetEnvironmentForTests();
});

describe("Stripe provider event processing", () => {
  it("grants paid Premium, queues exactly one PC/Mac delivery, redeems the discount, and schedules cancellation", async () => {
    const store = fakeStore();
    const session = {
      id: "cs_premium",
      mode: "payment",
      payment_status: "paid",
      payment_intent: "pi_premium",
      customer: "cus_premium",
      customer_details: { email: "Player@Example.com" },
      amount_total: 5_999,
      currency: "usd",
      metadata: {
        wl_product: "premium_lifetime_pass",
        wl_uid: "uid_premium",
        wl_mobile_platform: "android",
        wl_desktop_delivery: "steam",
        wl_legacy_discount: "1",
        wl_cancel_stripe_subscription: "sub_old"
      }
    } as unknown as Stripe.Checkout.Session;

    await processStripeEvent(store as unknown as EntitlementStore, stripeEvent("checkout.session.completed", session));

    expect(store.upsertGrant).toHaveBeenCalledWith(expect.objectContaining({
      uid: "uid_premium",
      provider: "stripe",
      providerCustomerId: "cus_premium",
      providerTransactionId: "pi_premium",
      product: "premium_lifetime_pass",
      state: "active",
      metadata: { stripeCheckoutSessionId: "cs_premium", primaryMobilePlatform: "android" }
    }), expect.objectContaining({ id: expect.stringMatching(/^evt_/) }));
    expect(store.saveLegacyOrder).toHaveBeenCalledWith(expect.objectContaining({
      id: "cs_premium",
      buyerEmail: "player@example.com",
      productCode: "POLY_STEAM",
      playMode: "STEAM",
      quantity: 1,
      firebaseUid: "uid_premium"
    }));
    expect(store.redeemLegacyDiscount).toHaveBeenCalledWith("uid_premium", "cs_premium", expect.any(Date));
    expect(store.enqueue).toHaveBeenCalledTimes(2);
    expect(store.enqueue).toHaveBeenNthCalledWith(1, "fulfill_legacy_order", "cs_premium", expect.objectContaining({
      productCode: "POLY_STEAM", sheetTab: "Polyglot Steam"
    }), expect.any(Date));
    expect(store.enqueue).toHaveBeenNthCalledWith(2, "cancel_stripe_subscription", "lifetime:pi_premium:sub_old", {
      uid: "uid_premium", subscriptionId: "sub_old", lifetimeTransactionId: "pi_premium"
    }, expect.any(Date));
  });

  it("does not grant or fulfill an unpaid Premium checkout", async () => {
    const store = fakeStore();
    const session = {
      id: "cs_unpaid",
      mode: "payment",
      payment_status: "unpaid",
      metadata: {
        wl_product: "premium_lifetime_pass",
        wl_uid: "uid_unpaid",
        wl_mobile_platform: "ios",
        wl_desktop_delivery: "direct"
      }
    } as unknown as Stripe.Checkout.Session;

    await processStripeEvent(store as unknown as EntitlementStore, stripeEvent("checkout.session.completed", session));
    expect(store.upsertGrant).not.toHaveBeenCalled();
    expect(store.saveLegacyOrder).not.toHaveBeenCalled();
    expect(store.enqueue).not.toHaveBeenCalled();
  });

  it("queues privacy-reduced ad conversions with stable provider deduplication keys", async () => {
    Object.assign(process.env, {
      AD_CONVERSIONS_ENABLED: "true",
      STRIPE_MUTATIONS_ENABLED: "false",
      STRIPE_SECRET_KEY: "sk_test_placeholder",
      STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
      STRIPE_PRICE_MOBILE_MONTHLY: "price_monthly",
      STRIPE_PRICE_POLYGLOT_PERMANENT: "price_polyglot",
      STRIPE_PRICE_PREMIUM_LIFETIME: "price_premium",
      STRIPE_COUPON_LEGACY_DESKTOP_50: "coupon_legacy",
      STRIPE_SUCCESS_URL: "https://wl-purchase-entitlement.netlify.app/account/?checkout=success",
      STRIPE_CANCEL_URL: "https://wl-purchase-entitlement.netlify.app/account/?checkout=cancel",
      STRIPE_PORTAL_RETURN_URL: "https://wl-purchase-entitlement.netlify.app/account/",
      PUBLIC_APP_ORIGIN: "https://wl-purchase-entitlement.netlify.app"
    });
    resetEnvironmentForTests();
    const store = fakeStore();
    store.checkoutContext.mockResolvedValue({
      uid: "uid_ads",
      ipAddress: "192.0.2.10",
      userAgent: "WonderLang Test Browser",
      fbp: "fb.1.test",
      ttclid: "tiktok-click-test"
    });
    const session = {
      id: "cs_ads",
      mode: "payment",
      payment_status: "paid",
      payment_intent: "pi_ads",
      customer_details: { email: "AdsPlayer@Example.com" },
      amount_total: 5_999,
      currency: "usd",
      metadata: {
        wl_product: "premium_lifetime_pass",
        wl_uid: "uid_ads",
        wl_mobile_platform: "ios",
        wl_desktop_delivery: "direct"
      }
    } as unknown as Stripe.Checkout.Session;

    await processStripeEvent(store as unknown as EntitlementStore, stripeEvent("checkout.session.completed", session, "evt_ads"));
    const conversionCalls = store.enqueue.mock.calls.filter(([kind]) => kind === "meta_conversion" || kind === "tiktok_conversion");
    expect(conversionCalls).toHaveLength(2);
    expect(conversionCalls.map(([kind, key]) => [kind, key])).toEqual([
      ["meta_conversion", "meta:cs_ads"],
      ["tiktok_conversion", "tiktok:cs_ads"]
    ]);
    for (const [, , payload] of conversionCalls) {
      expect(payload).toMatchObject({
        eventName: "Purchase",
        eventId: "cs_ads",
        eventSourceUrl: "https://wl-purchase-entitlement.netlify.app",
        value: 59.99,
        currency: "USD",
        product: "premium_lifetime_pass",
        ipAddress: "192.0.2.10",
        userAgent: "WonderLang Test Browser"
      });
      expect(payload.emailSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(payload.subjectUidHash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(payload)).not.toContain("AdsPlayer@Example.com");
      expect(JSON.stringify(payload)).not.toContain("uid_ads");
    }
  });

  it("fulfills a recognized historical website order without treating it as Premium", async () => {
    const store = fakeStore();
    const session = {
      id: "cs_legacy",
      mode: "payment",
      payment_status: "paid",
      payment_link: "plink_1RoLRRBFbQoDa6p0g9zXIJaM",
      payment_intent: "pi_legacy",
      customer_details: { email: "legacy@example.com" },
      amount_total: 6_000,
      currency: "eur",
      metadata: {},
      custom_fields: [{ key: "playmode", dropdown: { value: "Direct download / Itch" } }]
    } as unknown as Stripe.Checkout.Session;

    await processStripeEvent(store as unknown as EntitlementStore, stripeEvent("checkout.session.completed", session));
    expect(store.upsertGrant).not.toHaveBeenCalled();
    expect(store.saveLegacyOrder).toHaveBeenCalledWith(expect.objectContaining({
      productCode: "POLY_ITCH", playMode: "DIRECT", currency: "EUR", paymentLinkId: session.payment_link
    }));
    expect(store.enqueue).toHaveBeenCalledOnce();
    expect(store.enqueue).toHaveBeenCalledWith("fulfill_legacy_order", "cs_legacy", expect.objectContaining({
      sheetTab: "Polyglot Itch"
    }), expect.any(Date));
  });

  it("releases a reserved historical-owner discount when checkout expires", async () => {
    const store = fakeStore();
    const session = {
      id: "cs_expired",
      metadata: { wl_uid: "uid_discount", wl_legacy_discount: "1" }
    } as unknown as Stripe.Checkout.Session;
    await processStripeEvent(store as unknown as EntitlementStore, stripeEvent("checkout.session.expired", session));
    expect(store.releaseLegacyDiscount).toHaveBeenCalledWith("uid_discount", "cs_expired", expect.any(Date));
  });

  it("synchronizes a retained historical Stripe Monthly subscription", async () => {
    const store = fakeStore();
    stripeMock.subscriptions.retrieve.mockResolvedValue(monthlySubscription());

    await processStripeEvent(store as unknown as EntitlementStore, stripeEvent(
      "customer.subscription.updated",
      { id: "sub_historical_monthly" } as Stripe.Subscription
    ));

    expect(stripeMock.subscriptions.retrieve).toHaveBeenCalledWith("sub_historical_monthly");
    expect(store.upsertGrant).toHaveBeenCalledWith(expect.objectContaining({
      uid: "uid_monthly",
      providerTransactionId: "sub_historical_monthly",
      providerSubscriptionId: "sub_historical_monthly",
      product: "mobile_full_monthly",
      state: "active",
      currentPeriodEndsAt: new Date((created + 2_592_000) * 1000).toISOString()
    }), expect.any(Object));
  });

  it("places a failed historical subscription payment into the seven-day grace period", async () => {
    const store = fakeStore();
    stripeMock.subscriptions.retrieve.mockResolvedValue(monthlySubscription());
    const invoice = {
      id: "in_failed",
      parent: { subscription_details: { subscription: "sub_historical_monthly" } }
    } as unknown as Stripe.Invoice;

    await processStripeEvent(store as unknown as EntitlementStore, stripeEvent("invoice.payment_failed", invoice));
    expect(store.upsertGrant).toHaveBeenCalledWith(expect.objectContaining({
      state: "grace",
      graceEndsAt: new Date((created + 7 * 86_400) * 1000).toISOString(),
      metadata: expect.objectContaining({
        stripeStatus: "active",
        firstPaymentFailureAt: new Date(created * 1000).toISOString()
      })
    }), expect.any(Object));
  });

  it("revokes access only after a full Stripe refund", async () => {
    const store = fakeStore();
    const partial = { refunded: false, amount: 5_999, amount_refunded: 1_000, payment_intent: "pi_refund" } as Stripe.Charge;
    await processStripeEvent(store as unknown as EntitlementStore, stripeEvent("charge.refunded", partial, "evt_partial"));
    expect(store.revokeByProviderTransaction).not.toHaveBeenCalled();

    const full = { refunded: true, amount: 5_999, amount_refunded: 5_999, payment_intent: "pi_refund" } as Stripe.Charge;
    await processStripeEvent(store as unknown as EntitlementStore, stripeEvent("charge.refunded", full, "evt_full"));
    expect(store.revokeByProviderTransaction).toHaveBeenCalledWith({
      provider: "stripe",
      providerTransactionId: "pi_refund",
      state: "refunded",
      sourceEvent: { id: "evt_full", created },
      at: new Date(created * 1000)
    });
  });

  it("revokes a disputed PaymentIntent after resolving the Stripe charge", async () => {
    const store = fakeStore();
    stripeMock.charges.retrieve.mockResolvedValue({ id: "ch_disputed", payment_intent: "pi_disputed" });
    const dispute = { id: "dp_test", charge: "ch_disputed" } as Stripe.Dispute;

    await processStripeEvent(store as unknown as EntitlementStore, stripeEvent("charge.dispute.created", dispute, "evt_dispute"));
    expect(stripeMock.charges.retrieve).toHaveBeenCalledWith("ch_disputed");
    expect(store.revokeByProviderTransaction).toHaveBeenCalledWith(expect.objectContaining({
      provider: "stripe", providerTransactionId: "pi_disputed", state: "revoked"
    }));
  });
});
