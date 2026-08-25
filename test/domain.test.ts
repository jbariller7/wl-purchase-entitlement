import { describe, expect, it } from "vitest";
import { checkoutAdDecision, stripeInvoiceAdDecision } from "../src/domain/ad-policy.js";
import { projectEntitlements } from "../src/domain/entitlement-projector.js";
import { canUseLegacyLifetimeDiscount } from "../src/domain/legacy-discount.js";
import { planLifetimeTransition } from "../src/domain/lifetime-transition.js";
import type { LedgerGrant } from "../src/domain/model.js";
import { normalizeStripeSubscriptionState, stripeGraceEndsAt } from "../src/domain/subscription.js";
import { summarizeSubscription } from "../src/domain/account-summary.js";
import { routeLegacyOrder, routePremiumDesktopAccess } from "../src/legacy/catalog.js";
import {
  LEGACY_PLAY_PRODUCT_MAP,
  LEGACY_CHAPTER_FULL_UPGRADE_CUTOFF,
  MONTHLY_PRICE_USD_CENTS,
  POLYGLOT_PERMANENT_PRICE_USD_CENTS,
  PREMIUM_LIFETIME_PRICE_USD_CENTS,
  STRIPE_SUBSCRIPTION_TRIAL_DAYS
} from "../src/domain/catalog.js";
import { REGIONAL_PRICES, stripeMajorAmount, stripeMajorValue, stripeMinorAmount } from "../src/domain/regional-pricing.js";
import { priceChangeConfirmationPhrase } from "../src/admin/billing-service.js";
import { chapterMigrationGrant, chapterMigrationTransactionId, isEligibleHistoricalChapterPurchase } from "../src/domain/legacy-chapter-migration.js";
import { assertCheckoutOwnershipAvailable } from "../src/providers/stripe/checkout-service.js";

const now = new Date("2026-08-23T12:00:00.000Z");

function grant(overrides: Partial<LedgerGrant>): LedgerGrant {
  return {
    id: "grant-1",
    uid: "user-1",
    provider: "stripe",
    providerTransactionId: "txn-1",
    product: "mobile_full_monthly",
    state: "active",
    startsAt: "2026-08-01T00:00:00.000Z",
    ...overrides
  };
}

describe("effective entitlement projection", () => {
  it("grants all content and cloud saves for an active monthly subscription", () => {
    const value = projectEntitlements("user-1", [grant({})], now);
    expect(value).toMatchObject({
      fullGame: true,
      allLanguages: true,
      cloudSave: true,
      accessKind: "subscription",
      subscriptionState: "active"
    });
    expect(value.mobilePlatforms).toEqual(["android", "ios"]);
    expect(value.permanentMobilePlatforms).toEqual([]);
  });

  it("distinguishes temporary subscription platforms from permanent mobile ownership", () => {
    const value = projectEntitlements("user-1", [
      grant({}),
      grant({
        id: "permanent-android",
        product: "mobile_polyglot_permanent",
        providerTransactionId: "permanent-transaction",
        metadata: { mobilePlatform: "android" }
      })
    ], now);
    expect(value.mobilePlatforms).toEqual(["android", "ios"]);
    expect(value.permanentMobilePlatforms).toEqual(["android"]);
  });

  it("lets a subscriber buy permanent access but blocks a platform already owned forever", () => {
    const subscriptionOnly = projectEntitlements("user-1", [grant({})], now);
    expect(() => assertCheckoutOwnershipAvailable({ product: "mobile_polyglot_permanent", mobilePlatform: "android", useLegacyDesktopDiscount: false, confirmCancelExistingSubscription: false }, subscriptionOnly)).not.toThrow();

    const subscriptionAndPermanent = projectEntitlements("user-1", [
      grant({}),
      grant({ id: "permanent", product: "mobile_polyglot_permanent", providerTransactionId: "permanent", metadata: { mobilePlatform: "android" } })
    ], now);
    expect(() => assertCheckoutOwnershipAvailable({ product: "mobile_polyglot_permanent", mobilePlatform: "android", useLegacyDesktopDiscount: false, confirmCancelExistingSubscription: false }, subscriptionAndPermanent)).toThrow(/already has permanent android access/);
    expect(() => assertCheckoutOwnershipAvailable({ product: "mobile_polyglot_permanent", mobilePlatform: "ios", useLegacyDesktopDiscount: false, confirmCancelExistingSubscription: false }, subscriptionAndPermanent)).not.toThrow();
  });

  it("never sells an extra Polyglot platform to Premium owners who can request it", () => {
    const premium = projectEntitlements("user-1", [grant({ product: "premium_lifetime_pass", metadata: { mobilePlatform: "android" } })], now);
    expect(() => assertCheckoutOwnershipAvailable({ product: "mobile_polyglot_permanent", mobilePlatform: "ios", useLegacyDesktopDiscount: false, confirmCancelExistingSubscription: false }, premium)).toThrow(/Contact support to request it/);
  });

  it("keeps subscription access during the seven-day payment grace period", () => {
    const value = projectEntitlements(
      "user-1",
      [grant({ state: "grace", graceEndsAt: "2026-08-25T12:00:00.000Z" })],
      now
    );
    expect(value.cloudSave).toBe(true);
    expect(value.subscriptionState).toBe("grace");
  });

  it("preserves an historical chapter grant and combines it with an idempotent permanent migration grant", () => {
    const original = grant({
      id: "chapter",
      provider: "google_play",
      providerTransactionId: "play-old",
      product: "legacy_chapter_2",
      state: "active",
      startsAt: "2026-08-01T00:00:00.000Z"
    });
    const grants = [
      grant({ state: "grace", graceEndsAt: "2026-08-22T12:00:00.000Z" }),
      original,
      chapterMigrationGrant(original)!
    ];
    const value = projectEntitlements("user-1", grants, now);
    expect(value).toMatchObject({
      cloudSave: false,
      fullGame: true,
      allLanguages: true,
      chapters: [2],
      mobilePlatforms: ["android"],
      accessKind: "permanent"
    });
  });

  it("grandfathers a pre-split website lifetime grant as Premium", () => {
    const value = projectEntitlements(
      "user-1",
      [grant({ state: "expired" }), grant({ id: "life", product: "mobile_full_lifetime" })],
      now
    );
    expect(value).toMatchObject({
      fullGame: true,
      allLanguages: true,
      cloudSave: true,
      pcMacAccess: true,
      futureContent: true,
      secondMobilePlatformEligible: true,
      accessKind: "premium_lifetime"
    });
    expect(value.permanentMobilePlatforms).toEqual(["android", "ios"]);
  });

  it("fails closed when an active period has actually ended", () => {
    const value = projectEntitlements("user-1", [grant({ endsAt: "2026-08-23T11:59:59.000Z" })], now);
    expect(value).toMatchObject({ fullGame: false, cloudSave: false, subscriptionState: "inactive" });
  });

  it("does not grant mobile access merely for a historical desktop purchase", () => {
    const value = projectEntitlements("user-1", [grant({ product: "desktop_lifetime" })], now);
    expect(value).toMatchObject({ fullGame: false, cloudSave: false, accessKind: "none" });
  });

  it("removes refunded, revoked, pending, and expired grants from effective access", () => {
    for (const state of ["refunded", "revoked", "pending", "expired"] as const) {
      expect(projectEntitlements("user-1", [grant({ state })], now)).toMatchObject({ fullGame: false, cloudSave: false, accessKind: "none" });
    }
  });
});

describe("legacy desktop routing", () => {
  it("treats the existing full mobile SKU as platform-scoped Polyglot access", () => {
    expect(LEGACY_PLAY_PRODUCT_MAP.wonderlangfull).toBe("mobile_polyglot_permanent");
    const value = projectEntitlements("user-1", [grant({
      provider: "google_play",
      product: LEGACY_PLAY_PRODUCT_MAP.wonderlangfull!
    })], now);
    expect(value).toMatchObject({ accessKind: "permanent", fullGame: true, cloudSave: false, mobilePlatforms: ["android"] });
  });

  it("upgrades every restored historical chapter purchase to Polyglot access on its original platform", () => {
    expect(LEGACY_PLAY_PRODUCT_MAP).toMatchObject({ wonderlangch1: "legacy_chapter_1", wonderlangch2: "legacy_chapter_2", wonderlangch3: "legacy_chapter_3", wonderlangch4: "legacy_chapter_4" });
    expect(chapterMigrationTransactionId("GPA.1234")).toBe("chapter-full-upgrade:GPA.1234");
    expect(isEligibleHistoricalChapterPurchase("2026-08-24T23:59:59.999Z")).toBe(true);
    expect(isEligibleHistoricalChapterPurchase("2026-08-25T00:00:00.000Z")).toBe(false);
    expect(LEGACY_CHAPTER_FULL_UPGRADE_CUTOFF).toBe("2026-08-24T23:59:59.999Z");

    const original = grant({
      provider: "admin",
      providerTransactionId: "import:ios-chapter-order",
      product: "legacy_chapter_1",
      startsAt: "2026-08-01T00:00:00.000Z",
      metadata: { mobilePlatform: "ios" }
    });
    const migration = chapterMigrationGrant(original)!;
    expect(migration.metadata).toMatchObject({
      migration: "historical_chapter_to_polyglot_permanent",
      originalProduct: "legacy_chapter_1",
      originalTransactionId: "import:ios-chapter-order",
      mobilePlatform: "ios"
    });
    expect(projectEntitlements("user-1", [original, migration], now)).toMatchObject({
      accessKind: "permanent",
      fullGame: true,
      cloudSave: false,
      mobilePlatforms: ["ios"],
      permanentMobilePlatforms: ["ios"]
    });
  });

  it("keeps the original chapter audit record from unlocking new post-cutoff purchases", () => {
    expect(projectEntitlements("user-1", [grant({ product: "legacy_chapter_1" })], now)).toMatchObject({ accessKind: "legacy", chapters: [1], fullGame: false, cloudSave: false });
    expect(chapterMigrationGrant(grant({ product: "legacy_chapter_1", startsAt: "2026-08-25T00:00:00.000Z" }))).toBeUndefined();
    expect(projectEntitlements("user-1", [grant({ provider: "google_play", product: "legacy_mobile_full" })], now)).toMatchObject({ accessKind: "permanent", fullGame: true, allLanguages: true, cloudSave: false, mobilePlatforms: ["android"] });
  });

  it("routes a known single-language Steam checkout to its exact inventory", () => {
    expect(routeLegacyOrder({
      paymentLink: "plink_1RoKYZBFbQoDa6p0hCPS3d2g",
      customFields: [
        { key: "language", dropdown: { value: "German" } },
        { key: "play_mode", dropdown: { value: "Steam Key" } }
      ]
    })).toEqual({ productCode: "German", playMode: "STEAM", sheetTab: "German Steam", quantity: 1 });
  });

  it("routes BOGO direct download to two Polyglot Itch keys", () => {
    expect(routeLegacyOrder({
      paymentLink: "plink_1SzYQNBFbQoDa6p0A1WwDTCI",
      customFields: [{ key: "play_mode", dropdown: { value: "Direct Download" } }]
    })).toEqual({ productCode: "POLY_ITCH", playMode: "DIRECT", sheetTab: "Polyglot Itch", quantity: 2 });
  });

  it("does not treat an unknown Stripe Payment Link as discount proof or fulfillment", () => {
    expect(routeLegacyOrder({
      paymentLink: "plink_attacker",
      customFields: [{ key: "play_mode", dropdown: { value: "Steam" } }]
    })).toBeUndefined();
  });

  it("routes each Premium PC/Mac choice to exactly one existing Polyglot key inventory", () => {
    expect(routePremiumDesktopAccess("steam")).toEqual({ productCode: "POLY_STEAM", playMode: "STEAM", sheetTab: "Polyglot Steam", quantity: 1 });
    expect(routePremiumDesktopAccess("direct")).toEqual({ productCode: "POLY_ITCH", playMode: "DIRECT", sheetTab: "Polyglot Itch", quantity: 1 });
  });
});

describe("subscription and conversion policy", () => {
  it("exposes trial, renewal, cancellation and grace details for account UI", () => {
    expect(summarizeSubscription([grant({ metadata: { stripeStatus: "trialing", trialEndsAt: "2026-08-26T12:00:00.000Z" }, currentPeriodEndsAt: "2026-09-26T12:00:00.000Z" })])).toMatchObject({
      phase: "trial",
      trialEndsAt: "2026-08-26T12:00:00.000Z",
      renewsAt: "2026-09-26T12:00:00.000Z"
    });
    expect(summarizeSubscription([grant({ metadata: { stripeStatus: "active", cancelAtPeriodEnd: true }, currentPeriodEndsAt: "2026-09-01T00:00:00.000Z" })])).toMatchObject({
      phase: "cancelled",
      cancelAtPeriodEnd: true,
      endsAt: "2026-09-01T00:00:00.000Z"
    });
    expect(summarizeSubscription([grant({ state: "grace", graceEndsAt: "2026-08-30T12:00:00.000Z" })])).toMatchObject({
      phase: "grace",
      graceEndsAt: "2026-08-30T12:00:00.000Z"
    });
  });
  it("keeps the confirmed test catalog and trial terms in code", () => {
    expect(MONTHLY_PRICE_USD_CENTS).toBe(699);
    expect(POLYGLOT_PERMANENT_PRICE_USD_CENTS).toBe(3199);
    expect(PREMIUM_LIFETIME_PRICE_USD_CENTS).toBe(5999);
    expect(STRIPE_SUBSCRIPTION_TRIAL_DAYS).toBe(3);
    expect(Object.keys(REGIONAL_PRICES.monthly)).toHaveLength(37);
    expect(Object.keys(REGIONAL_PRICES.polyglot)).toHaveLength(37);
    expect(Object.keys(REGIONAL_PRICES.premium)).toHaveLength(37);
    expect(REGIONAL_PRICES.monthly.EUR).toBe("6.49");
    expect(REGIONAL_PRICES.polyglot.GBP).toBe("26.80");
    expect(REGIONAL_PRICES.premium.CAD).toBe("77.99");
    expect(stripeMinorAmount("USD", REGIONAL_PRICES.polyglot.USD!)).toBe(3199);
    expect(stripeMinorAmount("JPY", REGIONAL_PRICES.monthly.JPY!)).toBe(787);
    expect(stripeMajorAmount("JPY", 3600)).toBe("3600");
    expect(stripeMajorAmount("USD", 5999)).toBe("59.99");
    expect(stripeMajorValue("KRW", 7344)).toBe(7344);
    expect(stripeMajorValue("USD", 699)).toBe(6.99);
    expect(priceChangeConfirmationPhrase("premium", 5999, "USD")).toBe("CHANGE PREMIUM TO 59.99 USD");
    expect(priceChangeConfirmationPhrase("polyglot", 3600, "JPY")).toBe("CHANGE POLYGLOT TO 3600 JPY");
  });
  it("computes exactly seven days of Stripe failure grace", () => {
    expect(stripeGraceEndsAt(now)).toBe("2026-08-30T12:00:00.000Z");
    expect(normalizeStripeSubscriptionState({
      stripeStatus: "past_due",
      now,
      graceEndsAt: "2026-08-24T00:00:00.000Z"
    })).toBe("grace");
    expect(normalizeStripeSubscriptionState({ stripeStatus: "past_due", now, graceEndsAt: "2026-08-23T11:59:00.000Z" })).toBe("expired");
    expect(normalizeStripeSubscriptionState({ stripeStatus: "unpaid", now })).toBe("expired");
    expect(normalizeStripeSubscriptionState({ stripeStatus: "incomplete", now })).toBe("pending");
    expect(normalizeStripeSubscriptionState({ stripeStatus: "paused", now })).toBe("expired");
  });

  it("sends Subscribe for the first paid invoice but never for renewals", () => {
    expect(stripeInvoiceAdDecision({ billingReason: "subscription_create", paid: true, amountPaid: 699 })).toMatchObject({
      send: true,
      eventName: "Subscribe"
    });
    expect(stripeInvoiceAdDecision({ billingReason: "subscription_cycle", paid: true, amountPaid: 699 })).toEqual({
      send: false,
      reason: "subscription_renewal_or_adjustment"
    });
  });

  it("does not double-report subscription checkout and initial invoice", () => {
    expect(checkoutAdDecision({ mode: "subscription", paymentStatus: "paid" }).send).toBe(false);
    expect(checkoutAdDecision({ mode: "subscription", paymentStatus: "no_payment_required" })).toMatchObject({
      send: true,
      eventName: "StartTrial"
    });
  });
});

describe("lifetime transition and historical discount", () => {
  it("requires explicit cancellation confirmation from an active subscriber", () => {
    expect(planLifetimeTransition({
      uid: "user-1",
      activeStripeSubscriptionId: "sub_1",
      confirmedCancelExistingSubscription: false
    }).allowCheckout).toBe(false);
  });

  it("cancels a Stripe subscription only after the lifetime payment flow requests it", () => {
    expect(planLifetimeTransition({
      uid: "user-1",
      activeStripeSubscriptionId: "sub_1",
      confirmedCancelExistingSubscription: true
    })).toMatchObject({ allowCheckout: true, cancelStripeSubscriptionAfterPayment: "sub_1" });
  });

  it("never represents Apple or Google cancellation as automatic", () => {
    expect(planLifetimeTransition({
      uid: "user-1",
      activeStoreSubscription: "apple",
      confirmedCancelExistingSubscription: true
    })).toMatchObject({ allowCheckout: true, externalCancellationRequired: "apple" });
  });

  it("allows one private discount reservation for a verified desktop customer", () => {
    expect(canUseLegacyLifetimeDiscount({
      uid: "user-1",
      verifiedDesktopTransactionIds: ["cs_old"]
    }, now)).toBe(true);
    expect(canUseLegacyLifetimeDiscount({
      uid: "user-1",
      verifiedDesktopTransactionIds: ["cs_old"],
      redeemedAt: now.toISOString()
    }, now)).toBe(false);
  });
});
