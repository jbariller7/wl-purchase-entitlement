import { describe, expect, it } from "vitest";
import { checkoutAdDecision, stripeInvoiceAdDecision } from "../src/domain/ad-policy.js";
import { projectEntitlements } from "../src/domain/entitlement-projector.js";
import { canUseLegacyLifetimeDiscount } from "../src/domain/legacy-discount.js";
import { planLifetimeTransition } from "../src/domain/lifetime-transition.js";
import type { LedgerGrant } from "../src/domain/model.js";
import { normalizeStripeSubscriptionState, stripeGraceEndsAt } from "../src/domain/subscription.js";
import { routeLegacyOrder } from "../src/legacy/catalog.js";
import { LEGACY_PLAY_PRODUCT_MAP } from "../src/domain/catalog.js";

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

  it("ends subscription and cloud-save access after grace without deleting legacy chapters", () => {
    const grants = [
      grant({ state: "grace", graceEndsAt: "2026-08-22T12:00:00.000Z" }),
      grant({
        id: "chapter",
        provider: "google_play",
        providerTransactionId: "play-old",
        product: "legacy_chapter_2",
        state: "active"
      })
    ];
    const value = projectEntitlements("user-1", grants, now);
    expect(value).toMatchObject({ cloudSave: false, fullGame: false, chapters: [2], accessKind: "legacy" });
  });

  it("makes lifetime access dominant and permanent", () => {
    const value = projectEntitlements(
      "user-1",
      [grant({ state: "expired" }), grant({ id: "life", product: "mobile_full_lifetime" })],
      now
    );
    expect(value).toMatchObject({ fullGame: true, allLanguages: true, cloudSave: true, accessKind: "lifetime" });
  });

  it("fails closed when an active period has actually ended", () => {
    const value = projectEntitlements("user-1", [grant({ endsAt: "2026-08-23T11:59:59.000Z" })], now);
    expect(value).toMatchObject({ fullGame: false, cloudSave: false, subscriptionState: "inactive" });
  });

  it("does not grant mobile access merely for a historical desktop purchase", () => {
    const value = projectEntitlements("user-1", [grant({ product: "desktop_lifetime" })], now);
    expect(value).toMatchObject({ fullGame: false, cloudSave: false, accessKind: "none" });
  });
});

describe("legacy desktop routing", () => {
  it("treats the existing full mobile SKU as lifetime, including cloud save", () => {
    expect(LEGACY_PLAY_PRODUCT_MAP.wonderlangfull).toBe("mobile_full_lifetime");
    const value = projectEntitlements("user-1", [grant({
      provider: "google_play",
      product: LEGACY_PLAY_PRODUCT_MAP.wonderlangfull!
    })], now);
    expect(value).toMatchObject({ accessKind: "lifetime", fullGame: true, cloudSave: true });
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
});

describe("subscription and conversion policy", () => {
  it("computes exactly seven days of Stripe failure grace", () => {
    expect(stripeGraceEndsAt(now)).toBe("2026-08-30T12:00:00.000Z");
    expect(normalizeStripeSubscriptionState({
      stripeStatus: "past_due",
      now,
      graceEndsAt: "2026-08-24T00:00:00.000Z"
    })).toBe("grace");
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
