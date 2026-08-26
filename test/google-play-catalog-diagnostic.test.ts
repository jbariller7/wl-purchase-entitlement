import type { androidpublisher_v3 } from "googleapis";
import { describe, expect, it } from "vitest";
import type { GooglePlayEnvironment } from "../src/config/env.js";
import {
  diagnoseGooglePlayCatalog,
  type GooglePlayCatalogReader
} from "../src/providers/google-play/catalog-diagnostic.js";

function environment(rollout: GooglePlayEnvironment["GOOGLE_PLAY_POLYGLOT_ROLLOUT_PHASE"] = "legacy_live_new_draft"): GooglePlayEnvironment {
  return {
    GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL: "play@example.iam.gserviceaccount.com",
    GOOGLE_PLAY_PRIVATE_KEY: "test-only",
    GOOGLE_PLAY_PACKAGE_NAME: "com.wonderlang.app",
    GOOGLE_PLAY_MONTHLY_PRODUCT_ID: "wonderlangmonthly",
    GOOGLE_PLAY_MONTHLY_BASE_PLAN_ID: "monthly",
    GOOGLE_PLAY_POLYGLOT_PRODUCT_ID: "wonderlangfull",
    GOOGLE_PLAY_LEGACY_PURCHASE_OPTION_ID: "buy",
    GOOGLE_PLAY_POLYGLOT_PURCHASE_OPTION_ID: "buy-polyglot-permanent",
    GOOGLE_PLAY_POLYGLOT_ROLLOUT_PHASE: rollout,
    GOOGLE_PLAY_RTDN_AUDIENCE: "https://example.com/webhooks/google-play",
    GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL: "push@example.iam.gserviceaccount.com"
  };
}

function money(units: string, nanos: number): androidpublisher_v3.Schema$Money {
  return { currencyCode: "USD", units, nanos };
}

function subscription(): androidpublisher_v3.Schema$Subscription {
  return {
    packageName: "com.wonderlang.app",
    productId: "wonderlangmonthly",
    basePlans: [{
      basePlanId: "monthly",
      state: "ACTIVE",
      autoRenewingBasePlanType: { billingPeriodDuration: "P1M" },
      regionalConfigs: [{ regionCode: "US", newSubscriberAvailability: true, price: money("6", 990_000_000) }]
    }]
  };
}

function trial(): androidpublisher_v3.Schema$SubscriptionOffer {
  return {
    packageName: "com.wonderlang.app",
    productId: "wonderlangmonthly",
    basePlanId: "monthly",
    offerId: "three-day-trial",
    state: "ACTIVE",
    phases: [{
      duration: "P3D",
      recurrenceCount: 1,
      regionalConfigs: [{ regionCode: "US", free: {} }]
    }],
    regionalConfigs: [{ regionCode: "US", newSubscriberAvailability: true }]
  };
}

function purchaseOption(input: {
  id: string;
  state: "ACTIVE" | "DRAFT";
  legacyCompatible: boolean;
  units: string;
  nanos: number;
}): androidpublisher_v3.Schema$OneTimeProductPurchaseOption {
  return {
    purchaseOptionId: input.id,
    state: input.state,
    buyOption: { legacyCompatible: input.legacyCompatible },
    regionalPricingAndAvailabilityConfigs: [{
      regionCode: "US",
      availability: "AVAILABLE",
      price: money(input.units, input.nanos)
    }]
  };
}

function oneTimeProduct(newState: "ACTIVE" | "DRAFT" = "DRAFT"): androidpublisher_v3.Schema$OneTimeProduct {
  return {
    packageName: "com.wonderlang.app",
    productId: "wonderlangfull",
    purchaseOptions: [
      purchaseOption({ id: "buy", state: "ACTIVE", legacyCompatible: true, units: "25", nanos: 990_000_000 }),
      purchaseOption({ id: "buy-polyglot-permanent", state: newState, legacyCompatible: false, units: "31", nanos: 990_000_000 })
    ]
  };
}

function reader(overrides: Partial<GooglePlayCatalogReader> = {}): GooglePlayCatalogReader {
  return {
    async subscription() { return subscription(); },
    async subscriptionOffers() { return [trial()]; },
    async oneTimeProduct() { return oneTimeProduct(); },
    ...overrides
  };
}

describe("read-only Google Play catalog diagnostic", () => {
  it("proves the active Monthly/trial catalog and preserves the legacy-live/new-draft Polyglot split", async () => {
    const result = await diagnoseGooglePlayCatalog({
      reader: reader(),
      environment: environment(),
      controls: { GOOGLE_PLAY_WEBHOOKS_ENABLED: false },
      now: new Date("2026-08-25T22:00:00.000Z")
    });

    expect(result).toMatchObject({
      checkedAt: "2026-08-25T22:00:00.000Z",
      passed: true,
      readOnly: true,
      packageName: "com.wonderlang.app",
      rolloutPhase: "legacy_live_new_draft",
      webhookProcessingEnabled: false
    });
    expect(result.checks).toHaveLength(4);
    expect(result.checks.every((check) => check.state === "passed")).toBe(true);
    expect(result.checks.find((check) => check.id === "legacy-buy-option")?.details).toMatchObject({ state: "ACTIVE", usPrice: "USD 25.99" });
    expect(result.checks.find((check) => check.id === "polyglot-purchase-option")?.details).toMatchObject({ state: "DRAFT", usPrice: "USD 31.99" });
  });

  it("changes only the expected new-option state after the compatible Android rollout phase is selected", async () => {
    const result = await diagnoseGooglePlayCatalog({
      reader: reader({ async oneTimeProduct() { return oneTimeProduct("ACTIVE"); } }),
      environment: environment("compatible_update_live"),
      controls: { GOOGLE_PLAY_WEBHOOKS_ENABLED: false },
      now: new Date("2026-08-25T22:00:00.000Z")
    });

    expect(result.passed).toBe(true);
    expect(result.checks.find((check) => check.id === "legacy-buy-option")?.details).toMatchObject({ state: "ACTIVE" });
    expect(result.checks.find((check) => check.id === "polyglot-purchase-option")?.details).toMatchObject({ state: "ACTIVE" });
  });

  it("reports missing catalog resources and sanitizes provider failures", async () => {
    const result = await diagnoseGooglePlayCatalog({
      reader: reader({
        async subscription() { return { ...subscription(), basePlans: [] }; },
        async subscriptionOffers() { throw new Error("raw Google response containing private diagnostics"); },
        async oneTimeProduct() { throw new Error("raw Google response containing private diagnostics"); }
      }),
      environment: environment(),
      controls: { GOOGLE_PLAY_WEBHOOKS_ENABLED: true },
      now: new Date("2026-08-25T22:00:00.000Z")
    });

    expect(result.passed).toBe(false);
    expect(result.webhookProcessingEnabled).toBe(true);
    expect(result.checks.find((check) => check.id === "monthly-base-plan")?.issues).toContain(
      "The expected Monthly base plan is missing; the subscription cannot be sold yet."
    );
    expect(result.checks.find((check) => check.id === "monthly-three-day-trial")?.issues).toContain(
      "The trial cannot exist until the Monthly base plan is saved."
    );
    expect(result.checks.find((check) => check.id === "polyglot-purchase-option")?.issues).toEqual([
      "Google Play could not read the new Polyglot purchase option with the configured credential."
    ]);
    expect(JSON.stringify(result)).not.toContain("raw Google response");
  });
});
