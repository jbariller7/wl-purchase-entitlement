import { beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogService } from "../src/catalog/service.js";
import { resetEnvironmentForTests } from "../src/config/env.js";

const retrieve = vi.fn(async () => { throw new Error("Stripe must not be called during a catalog read."); });

vi.mock("../src/providers/stripe/client.js", () => ({
  stripeClient: vi.fn(() => ({ prices: { retrieve } }))
}));

describe("provider-isolated catalog reads", () => {
  beforeEach(() => {
    Object.assign(process.env, {
      APP_ENVIRONMENT: "test",
      STRIPE_MUTATIONS_ENABLED: "false",
      STRIPE_SECRET_KEY: "rk_test_invalid_but_isolated",
      STRIPE_WEBHOOK_SECRET: "whsec_test",
      STRIPE_PRICE_MOBILE_MONTHLY: "price_monthly",
      STRIPE_PRICE_POLYGLOT_PERMANENT: "price_polyglot",
      STRIPE_PRICE_PREMIUM_LIFETIME: "price_premium",
      STRIPE_COUPON_LEGACY_DESKTOP_50: "coupon_legacy",
      STRIPE_SUCCESS_URL: "https://example.com/account/?checkout=success",
      STRIPE_CANCEL_URL: "https://example.com/account/?checkout=cancelled",
      STRIPE_PORTAL_RETURN_URL: "https://example.com/account/",
      PUBLIC_APP_ORIGIN: "https://example.com"
    });
    retrieve.mockClear();
    resetEnvironmentForTests();
  });

  it("uses configured Price IDs and approved defaults without contacting Stripe", async () => {
    const db = {
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({ get: vi.fn(async () => ({ exists: false })) }))
      }))
    };

    const catalog = await new CatalogService(db as never).get();

    expect(catalog).toMatchObject({
      monthly: { stripePriceId: "price_monthly", unitAmount: 699, currency: "USD", recurring: true },
      polyglot: { stripePriceId: "price_polyglot", unitAmount: 3199, currency: "USD", recurring: false },
      premium: { stripePriceId: "price_premium", unitAmount: 5999, currency: "USD", recurring: false }
    });
    expect(retrieve).not.toHaveBeenCalled();
  });
});
