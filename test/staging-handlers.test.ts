import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HandlerEvent } from "@netlify/functions";

vi.mock("../src/providers/apple/service.js", () => ({
  verifyAppleNotification: vi.fn(() => { throw new Error("Apple SDK must not be called while disabled."); }),
  processAppleNotification: vi.fn(),
  claimAppleTransaction: vi.fn()
}));
vi.mock("../src/providers/google-play/rtdn.js", () => ({
  verifyPubSubAuthorization: vi.fn(() => { throw new Error("Google SDK must not be called while disabled."); }),
  parseRtdn: vi.fn(),
  processRtdn: vi.fn()
}));
vi.mock("../src/providers/google-play/service.js", () => ({
  syncGooglePlayOneTimeProduct: vi.fn(),
  syncGooglePlaySubscription: vi.fn()
}));
vi.mock("../src/infrastructure/firebase.js", () => ({
  firebaseAppCheck: vi.fn(),
  firebaseAuth: vi.fn(),
  firebaseStorage: vi.fn(),
  firestore: vi.fn()
}));
import { lambdaHandler as appleHandler } from "../netlify/functions/apple-webhook.js";
import { lambdaHandler as apiHandler } from "../netlify/functions/api.js";
import { lambdaHandler as googlePlayHandler } from "../netlify/functions/google-play-webhook.js";
import { lambdaHandler as healthHandler } from "../netlify/functions/health.js";
import { lambdaHandler as outboxHandler } from "../netlify/functions/outbox-worker.js";
import { lambdaHandler as stripeHandler } from "../netlify/functions/stripe-webhook.js";
import { lambdaHandler as reconciliationHandler } from "../netlify/functions/subscription-reconciliation.js";
import { resetEnvironmentForTests } from "../src/config/env.js";

const original = { ...process.env };
const credentialKeys = [
  "FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY", "FIREBASE_STORAGE_BUCKET",
  "FIREBASE_WEB_API_KEY", "FIREBASE_AUTH_DOMAIN", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_MOBILE_MONTHLY", "STRIPE_PRICE_POLYGLOT_PERMANENT", "STRIPE_PRICE_PREMIUM_LIFETIME", "STRIPE_COUPON_LEGACY_DESKTOP_50",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY", "GOOGLE_SHEET_ID", "MAILERLITE_API_TOKEN"
];

function event(): HandlerEvent {
  return {
    rawUrl: "https://test.example.com/webhook",
    rawQuery: "",
    path: "/webhook",
    httpMethod: "POST",
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: "{}",
    isBase64Encoded: false
  };
}

beforeEach(() => {
  for (const key of credentialKeys) delete process.env[key];
  Object.assign(process.env, {
    APP_ENVIRONMENT: "test",
    STRIPE_WEBHOOKS_ENABLED: "false",
    GOOGLE_PLAY_WEBHOOKS_ENABLED: "false",
    APPLE_WEBHOOKS_ENABLED: "false",
    OUTBOX_PROCESSING_ENABLED: "false",
    SUBSCRIPTION_RECONCILIATION_ENABLED: "false"
  });
  resetEnvironmentForTests();
});

afterEach(() => {
  process.env = { ...original };
  resetEnvironmentForTests();
});

describe("staging function boundaries", () => {
  it.each([
    ["Stripe", stripeHandler],
    ["Google Play", googlePlayHandler],
    ["Apple", appleHandler]
  ])("rejects %s webhook processing before touching providers", async (_name, handler) => {
    const response = await handler(event(), {} as never);
    expect(response).toMatchObject({ statusCode: 503 });
    expect(String(response?.body)).toMatch(/disabled/i);
  });

  it("does not lease or complete outbox jobs while the worker is disabled", async () => {
    const response = await outboxHandler(event(), {} as never);
    expect(response).toMatchObject({ statusCode: 200 });
    expect(JSON.parse(String(response?.body))).toEqual({ processed: 0, failed: 0 });
  });

  it("does not query billing providers while subscription reconciliation is disabled", async () => {
    const response = await reconciliationHandler(event(), {} as never);
    expect(response).toMatchObject({ statusCode: 200 });
    expect(JSON.parse(String(response?.body))).toEqual({
      state: "disabled", attempted: 0, succeeded: 0, failed: 0
    });
  });

  it("reports safe mode without requiring or exposing credentials", async () => {
    const response = await healthHandler({ ...event(), httpMethod: "GET" }, {} as never);
    expect(response).toMatchObject({ statusCode: 200 });
    const body = JSON.parse(String(response?.body));
    expect(body).toMatchObject({ status: "configuration_required", environment: "test", safeMode: true });
    expect(body.configuration).toMatchObject({ firebaseAdmin: false, stripeTest: false });
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE_KEY|SECRET_KEY|ACCESS_TOKEN/);
  });

  it("detects copied legacy credentials without enabling fulfillment or outbox work", async () => {
    Object.assign(process.env, {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "legacy-test@example.com",
      GOOGLE_PRIVATE_KEY: "test-private-key",
      GOOGLE_SHEET_ID: "test-sheet",
      MAILERLITE_API_TOKEN: "test-mailerlite-token"
    });
    const health = await healthHandler({ ...event(), httpMethod: "GET" }, {} as never);
    const body = JSON.parse(String(health?.body));
    expect(body).toMatchObject({
      safeMode: true,
      controls: { LEGACY_FULFILLMENT_ENABLED: false, OUTBOX_PROCESSING_ENABLED: false },
      configuration: { legacyFulfillment: true }
    });
    const worker = await outboxHandler(event(), {} as never);
    expect(JSON.parse(String(worker?.body))).toEqual({ processed: 0, failed: 0 });
  });

  it("returns a clean configuration gate while account dependencies are absent", async () => {
    const response = await apiHandler({
      ...event(),
      rawUrl: "https://test.example.com/api/v1/config",
      path: "/api/v1/config",
      httpMethod: "GET",
      headers: { origin: "https://wonderlang.net" }
    }, {} as never);
    expect(response).toMatchObject({ statusCode: 503 });
    expect(response?.headers).toMatchObject({ "access-control-allow-origin": "https://wonderlang.net" });
    expect(JSON.parse(String(response?.body))).toEqual({
      error: "Account testing is not configured yet. Finish the Firebase and Stripe test setup at /setup/."
    });
  });

  it("rejects an untrusted browser Origin before configuration or authentication work", async () => {
    const response = await apiHandler({
      ...event(),
      path: "/api/v1/config",
      httpMethod: "GET",
      headers: { origin: "https://evil.example" }
    }, {} as never);
    expect(response).toMatchObject({ statusCode: 403 });
    expect(response?.headers).not.toHaveProperty("access-control-allow-origin");
  });
});
