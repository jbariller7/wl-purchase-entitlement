import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import type { CatalogConfiguration, CatalogOfferKind } from "../src/catalog/service.js";
import { diagnoseStripeCatalog } from "../src/providers/stripe/catalog-diagnostic.js";

const kinds: CatalogOfferKind[] = ["monthly", "polyglot", "premium"];

function catalog(): CatalogConfiguration {
  return {
    revision: 0,
    monthly: { stripePriceId: "price_monthly", unitAmount: 699, currency: "USD", recurring: true },
    polyglot: { stripePriceId: "price_polyglot", unitAmount: 3199, currency: "USD", recurring: false },
    premium: { stripePriceId: "price_premium", unitAmount: 5999, currency: "USD", recurring: false },
    monthlyPriceHistory: ["price_monthly"],
    polyglotPriceHistory: ["price_polyglot"],
    premiumPriceHistory: ["price_premium"],
    regionalPrices: {
      monthly: { USD: "6.99", EUR: "6.49", KWD: "1.49" },
      polyglot: { USD: "31.99", EUR: "30.99", KWD: "5.20" },
      premium: { USD: "59.99", EUR: "59.99", KWD: "9.75" }
    }
  };
}

function price(kind: CatalogOfferKind): Stripe.Price {
  const amounts: [number, number] = { monthly: [699, 649], polyglot: [3199, 3099], premium: [5999, 5999] }[kind] as [number, number];
  return {
    id: `price_${kind}`,
    object: "price",
    active: true,
    billing_scheme: "per_unit",
    created: 1,
    currency: "usd",
    currency_options: { eur: { custom_unit_amount: null, tax_behavior: "unspecified", tiers: [], unit_amount: amounts[1], unit_amount_decimal: String(amounts[1]) } },
    custom_unit_amount: null,
    livemode: false,
    lookup_key: null,
    metadata: {},
    nickname: null,
    product: `prod_${kind}`,
    recurring: kind === "monthly" ? { interval: "month", interval_count: 1, meter: null, trial_period_days: null, usage_type: "licensed" } : null,
    tax_behavior: "unspecified",
    tiers_mode: null,
    transform_quantity: null,
    type: kind === "monthly" ? "recurring" : "one_time",
    unit_amount: amounts[0],
    unit_amount_decimal: String(amounts[0])
  } as unknown as Stripe.Price;
}

function product(id: string): Stripe.Product {
  return {
    id,
    object: "product",
    active: true,
    created: 1,
    default_price: null,
    description: null,
    images: [],
    livemode: false,
    marketing_features: [],
    metadata: {},
    name: id,
    package_dimensions: null,
    shippable: null,
    statement_descriptor: null,
    tax_code: null,
    type: "service",
    unit_label: null,
    updated: 1,
    url: null
  } as unknown as Stripe.Product;
}

function coupon(): Stripe.Coupon {
  return {
    id: "coupon_legacy",
    object: "coupon",
    amount_off: null,
    created: 1,
    currency: null,
    duration: "once",
    duration_in_months: null,
    livemode: false,
    max_redemptions: null,
    metadata: {},
    name: "Historical owner",
    percent_off: 50,
    redeem_by: null,
    times_redeemed: 0,
    valid: true
  };
}

function client(overrides: Partial<Record<CatalogOfferKind, Stripe.Price>> = {}) {
  const prices = Object.fromEntries(kinds.map((kind) => [`price_${kind}`, overrides[kind] ?? price(kind)]));
  const pricesRetrieve = vi.fn(async (id: string) => prices[id] as Stripe.Price);
  const productsRetrieve = vi.fn(async (id: string) => product(id));
  const couponsRetrieve = vi.fn(async () => coupon());
  return {
    value: {
      prices: { retrieve: pricesRetrieve },
      products: { retrieve: productsRetrieve },
      coupons: { retrieve: couponsRetrieve }
    } as unknown as Pick<Stripe, "prices" | "products" | "coupons">,
    pricesRetrieve,
    productsRetrieve,
    couponsRetrieve
  };
}

describe("read-only Stripe catalog diagnostic", () => {
  it("validates the restricted test key, all configured Prices/Products, regional amounts and Coupon without enabling the canary", async () => {
    const fake = client();
    const result = await diagnoseStripeCatalog({
      client: fake.value,
      catalog: catalog(),
      environment: { STRIPE_SECRET_KEY: "rk_test_redacted", STRIPE_COUPON_LEGACY_DESKTOP_50: "coupon_legacy" },
      controls: { STRIPE_MUTATIONS_ENABLED: false, STRIPE_WEBHOOKS_ENABLED: false },
      now: new Date("2026-08-25T20:00:00.000Z")
    });

    expect(result).toMatchObject({
      checkedAt: "2026-08-25T20:00:00.000Z",
      mode: "test",
      keyType: "restricted",
      passed: true,
      readOnly: true,
      canarySwitches: { stripeMutations: false, stripeWebhooks: false, checkoutTestingEnabled: false }
    });
    expect(result.checks).toHaveLength(4);
    expect(result.checks.every((check) => check.state === "passed")).toBe(true);
    expect(fake.pricesRetrieve).toHaveBeenCalledTimes(3);
    expect(fake.productsRetrieve).toHaveBeenCalledTimes(3);
    expect(fake.couponsRetrieve).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("rk_test_redacted");
  });

  it("reports catalog mismatches and sanitizes provider failures", async () => {
    const wrongPremium = { ...price("premium"), livemode: true, unit_amount: 6000 } as Stripe.Price;
    const fake = client({ premium: wrongPremium });
    fake.pricesRetrieve.mockImplementation(async (id: string) => {
      if (id === "price_polyglot") throw new Error("raw Stripe response containing private diagnostics");
      return ({ price_monthly: price("monthly"), price_premium: wrongPremium } as Record<string, Stripe.Price>)[id] as Stripe.Price;
    });
    const result = await diagnoseStripeCatalog({
      client: fake.value,
      catalog: catalog(),
      environment: { STRIPE_SECRET_KEY: "rk_test_redacted", STRIPE_COUPON_LEGACY_DESKTOP_50: "coupon_legacy" },
      controls: { STRIPE_MUTATIONS_ENABLED: true, STRIPE_WEBHOOKS_ENABLED: false },
      now: new Date("2026-08-25T20:00:00.000Z")
    });

    expect(result.passed).toBe(false);
    expect(result.canarySwitches.checkoutTestingEnabled).toBe(false);
    expect(result.checks.find((check) => check.id === "premium-price")?.issues).toEqual(expect.arrayContaining([
      "Price belongs to live mode instead of the Stripe test environment.",
      "Default USD amount does not match the WonderLang catalog."
    ]));
    expect(result.checks.find((check) => check.id === "polyglot-price")?.issues).toEqual([
      "Stripe could not read this Price and Product with the configured test credential."
    ]);
    expect(JSON.stringify(result)).not.toContain("raw Stripe response");
  });
});
