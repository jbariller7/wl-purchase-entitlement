import { afterEach, describe, expect, it } from "vitest";
import { env, resetEnvironmentForTests } from "../src/config/env.js";

const original = { ...process.env };
const required = {
  FIREBASE_PROJECT_ID: "wonderlang-test",
  FIREBASE_CLIENT_EMAIL: "firebase@example.com",
  FIREBASE_PRIVATE_KEY: "test-private-key",
  FIREBASE_STORAGE_BUCKET: "wonderlang-test.appspot.com",
  FIREBASE_WEB_API_KEY: "test-web-key",
  FIREBASE_AUTH_DOMAIN: "wonderlang-test.firebaseapp.com",
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  STRIPE_PRICE_MOBILE_MONTHLY: "price_test_monthly",
  STRIPE_PRICE_POLYGLOT_PERMANENT: "price_test_polyglot",
  STRIPE_PRICE_PREMIUM_LIFETIME: "price_test_premium",
  STRIPE_COUPON_LEGACY_DESKTOP_50: "coupon_test",
  STRIPE_SUCCESS_URL: "https://test.example.com/success",
  STRIPE_CANCEL_URL: "https://test.example.com/cancel",
  STRIPE_PORTAL_RETURN_URL: "https://test.example.com/account",
  PUBLIC_APP_ORIGIN: "https://test.example.com"
};

afterEach(() => {
  process.env = { ...original };
  resetEnvironmentForTests();
});

describe("deployment safety", () => {
  it("refuses a live Stripe key in test mode", () => {
    Object.assign(process.env, required, { APP_ENVIRONMENT: "test", STRIPE_SECRET_KEY: "sk_live_forbidden" });
    expect(() => env()).toThrow(/require a Stripe sk_test_/);
  });

  it("keeps every side-effect switch off by default", () => {
    Object.assign(process.env, required, { APP_ENVIRONMENT: "test", STRIPE_SECRET_KEY: "sk_test_allowed" });
    expect(env()).toMatchObject({
      STRIPE_WEBHOOKS_ENABLED: false,
      GOOGLE_PLAY_WEBHOOKS_ENABLED: false,
      APPLE_WEBHOOKS_ENABLED: false,
      OUTBOX_PROCESSING_ENABLED: false,
      AD_CONVERSIONS_ENABLED: false,
      LEGACY_FULFILLMENT_ENABLED: false,
      SUBSCRIPTION_CANCELLATION_ENABLED: false,
      ACCOUNT_DELETION_PROCESSING_ENABLED: false,
      STRIPE_MUTATIONS_ENABLED: false
    });
  });
});
