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
import { lambdaHandler as cloudStorageMonitorHandler } from "../netlify/functions/cloud-storage-monitor.js";
import { lambdaHandler as cloudSaveCleanupHandler } from "../netlify/functions/cloud-save-cleanup.js";
import { lambdaHandler as deviceSignInCleanupHandler } from "../netlify/functions/device-sign-in-cleanup.js";
import { resetEnvironmentForTests } from "../src/config/env.js";
import { firestore } from "../src/infrastructure/firebase.js";
import { parseRtdn, processRtdn, verifyPubSubAuthorization } from "../src/providers/google-play/rtdn.js";

const original = { ...process.env };
const credentialKeys = [
  "FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY", "FIREBASE_STORAGE_BUCKET",
  "FIREBASE_WEB_API_KEY", "FIREBASE_AUTH_DOMAIN", "FIREBASE_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_MOBILE_MONTHLY", "STRIPE_PRICE_POLYGLOT_PERMANENT", "STRIPE_PRICE_PREMIUM_LIFETIME", "STRIPE_COUPON_LEGACY_DESKTOP_50",
  "STRIPE_SUCCESS_URL", "STRIPE_CANCEL_URL", "STRIPE_PORTAL_RETURN_URL", "PUBLIC_APP_ORIGIN",
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
  vi.clearAllMocks();
  for (const key of credentialKeys) delete process.env[key];
  Object.assign(process.env, {
    APP_ENVIRONMENT: "test",
    STRIPE_WEBHOOKS_ENABLED: "false",
    GOOGLE_PLAY_WEBHOOKS_ENABLED: "false",
    APPLE_WEBHOOKS_ENABLED: "false",
    OUTBOX_PROCESSING_ENABLED: "false",
    SUBSCRIPTION_RECONCILIATION_ENABLED: "false",
    CLOUD_STORAGE_MONITORING_ENABLED: "false",
    CLOUD_SAVE_CLEANUP_ENABLED: "false",
    DEVICE_SIGN_IN_ENABLED: "false",
    DEVICE_SIGN_IN_CLEANUP_ENABLED: "false",
    ADMIN_BOOTSTRAP_ENABLED: "false"
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

  it("accepts only a signed Google Play connectivity probe while webhook processing is disabled", async () => {
    vi.mocked(verifyPubSubAuthorization).mockResolvedValueOnce(undefined);
    vi.mocked(parseRtdn).mockReturnValueOnce({
      messageId: "test-message",
      eventCreated: 1_700_000_000,
      notification: {
        packageName: "com.wonderlang.app",
        eventTimeMillis: "1700000000000",
        testNotification: { version: "1.0" }
      },
      raw: { testNotification: { version: "1.0" } }
    });
    const response = await googlePlayHandler({
      ...event(),
      headers: { authorization: "Bearer signed-google-probe" }
    }, {} as never);
    expect(response).toEqual({ statusCode: 204 });
    expect(verifyPubSubAuthorization).toHaveBeenCalledWith("Bearer signed-google-probe");
    expect(processRtdn).not.toHaveBeenCalled();
    expect(vi.mocked(firestore)).not.toHaveBeenCalled();
  });

  it("does not query billing providers while subscription reconciliation is disabled", async () => {
    const response = await reconciliationHandler(event(), {} as never);
    expect(response).toMatchObject({ statusCode: 200 });
    expect(JSON.parse(String(response?.body))).toEqual({
      state: "disabled", attempted: 0, succeeded: 0, failed: 0
    });
  });

  it("does not list Firebase Storage while cloud monitoring is disabled", async () => {
    const response = await cloudStorageMonitorHandler(event(), {} as never);
    expect(response).toMatchObject({ statusCode: 200 });
    expect(JSON.parse(String(response?.body))).toEqual({ state: "disabled", scanned: 0 });
  });

  it("does not access Firebase or delete revisions while cloud-save cleanup is disabled", async () => {
    const response = await cloudSaveCleanupHandler(event(), {} as never);
    expect(response).toMatchObject({ statusCode: 200 });
    expect(JSON.parse(String(response?.body))).toEqual({
      state: "disabled", scanned: 0, deleted: 0, failed: 0, skipped: 0
    });
    expect(vi.mocked(firestore)).not.toHaveBeenCalled();
  });

  it("does not access Firebase or issue a token while PC/Mac device sign-in is disabled", async () => {
    const response = await apiHandler({
      ...event(),
      rawUrl: "https://test.example.com/api/v1/device-sign-in/start",
      path: "/api/v1/device-sign-in/start",
      headers: { origin: "null" },
      body: JSON.stringify({ deviceLabel: "WonderLang PC" })
    }, {} as never);
    expect(response).toMatchObject({ statusCode: 503 });
    expect(JSON.parse(String(response?.body))).toEqual({ error: "PC/Mac device sign-in is disabled in this deployment." });
    expect(vi.mocked(firestore)).not.toHaveBeenCalled();
    expect(response?.headers).toMatchObject({ "access-control-allow-origin": "null" });
  });

  it("does not query or delete device codes while expiration cleanup is disabled", async () => {
    const response = await deviceSignInCleanupHandler(event(), {} as never);
    expect(response).toMatchObject({ statusCode: 200 });
    expect(JSON.parse(String(response?.body))).toEqual({ state: "disabled", deleted: 0 });
    expect(vi.mocked(firestore)).not.toHaveBeenCalled();
  });

  it("reports safe mode without requiring or exposing credentials", async () => {
    const response = await healthHandler({ ...event(), httpMethod: "GET" }, {} as never);
    expect(response).toMatchObject({ statusCode: 200 });
    const body = JSON.parse(String(response?.body));
    expect(body).toMatchObject({ status: "configuration_required", environment: "test", safeMode: true });
    expect(body.readiness).toEqual({ accountTesting: false, stripeConfigured: false, checkoutTesting: false });
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
      configuration: { legacyFulfillment: true, googlePlay: false }
    });
    const worker = await outboxHandler(event(), {} as never);
    expect(JSON.parse(String(worker?.body))).toEqual({ processed: 0, failed: 0 });
  });

  it("requires Play-authorized credentials and RTDN configuration before reporting Google Play ready", async () => {
    Object.assign(process.env, {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "play-verifier@example.iam.gserviceaccount.com",
      GOOGLE_PRIVATE_KEY: "test-play-private-key",
      GOOGLE_PLAY_PACKAGE_NAME: "com.wonderlang.app",
      GOOGLE_PLAY_RTDN_AUDIENCE: "https://test.example.com/webhooks/google-play",
      GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL: "rtdn-push@example.iam.gserviceaccount.com"
    });
    const health = await healthHandler({ ...event(), httpMethod: "GET" }, {} as never);
    expect(JSON.parse(String(health?.body))).toMatchObject({
      safeMode: true,
      controls: { GOOGLE_PLAY_WEBHOOKS_ENABLED: false },
      configuration: { googlePlay: true, legacyFulfillment: false }
    });
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
      error: "Account login is not configured yet. Finish Firebase web setup at /setup/."
    });
  });

  it("allows Firebase web login configuration without enabling backend account or Stripe operations", async () => {
    Object.assign(process.env, {
      FIREBASE_WEB_API_KEY: "public-firebase-web-test-key",
      FIREBASE_AUTH_DOMAIN: "test-project.firebaseapp.com",
      FIREBASE_PROJECT_ID: "test-project",
      FIREBASE_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY: "public-recaptcha-enterprise-site-key"
    });
    const response = await apiHandler({
      ...event(),
      rawUrl: "https://test.example.com/api/v1/config",
      path: "/api/v1/config",
      httpMethod: "GET",
      headers: { origin: "https://wonderlang.net" }
    }, {} as never);
    expect(response).toMatchObject({ statusCode: 200 });
    const body = JSON.parse(String(response?.body));
    expect(body).toMatchObject({
      environment: "test",
      accountApiReady: false,
      checkoutEnabled: false,
      appCheckEnforced: false,
      appCheckConfigured: true,
      appCheck: { recaptchaEnterpriseSiteKey: "public-recaptcha-enterprise-site-key" },
      firebase: {
        apiKey: "public-firebase-web-test-key",
        authDomain: "test-project.firebaseapp.com",
        projectId: "test-project"
      },
      catalog: {
        revision: 0,
        monthly: { unitAmount: 699, currency: "USD", recurring: true },
        polyglot: { unitAmount: 3199, currency: "USD", recurring: false },
        premium: { unitAmount: 5999, currency: "USD", recurring: false }
      }
    });
    expect(vi.mocked(firestore)).not.toHaveBeenCalled();
  });

  it("enables the Firebase account API without requiring Stripe credentials", async () => {
    Object.assign(process.env, {
      FIREBASE_WEB_API_KEY: "public-firebase-web-test-key",
      FIREBASE_AUTH_DOMAIN: "test-project.firebaseapp.com",
      FIREBASE_PROJECT_ID: "test-project",
      FIREBASE_CLIENT_EMAIL: "firebase-admin@test-project.iam.gserviceaccount.com",
      FIREBASE_PRIVATE_KEY: "test-private-key",
      FIREBASE_STORAGE_BUCKET: "test-project.firebasestorage.app"
    });
    const response = await apiHandler({
      ...event(),
      rawUrl: "https://test.example.com/api/v1/config",
      path: "/api/v1/config",
      httpMethod: "GET",
      headers: { origin: "https://wonderlang.net" }
    }, {} as never);
    expect(response).toMatchObject({ statusCode: 200 });
    expect(JSON.parse(String(response?.body))).toMatchObject({
      environment: "test",
      accountApiReady: true,
      checkoutEnabled: false,
      appCheckEnforced: false
    });
    expect(vi.mocked(firestore)).not.toHaveBeenCalled();

    const health = await healthHandler({ ...event(), httpMethod: "GET" }, {} as never);
    expect(JSON.parse(String(health?.body))).toMatchObject({
      status: "ready_for_account_testing",
      readiness: { accountTesting: true, stripeConfigured: false, checkoutTesting: false },
      configuration: { firebaseAdmin: true, firebaseWeb: true, stripeTest: false }
    });
  });

  it("reports Stripe configuration without falsely claiming checkout testing while processing is off", async () => {
    Object.assign(process.env, {
      FIREBASE_WEB_API_KEY: "public-firebase-web-test-key",
      FIREBASE_AUTH_DOMAIN: "test-project.firebaseapp.com",
      FIREBASE_PROJECT_ID: "test-project",
      FIREBASE_CLIENT_EMAIL: "firebase-admin@test-project.iam.gserviceaccount.com",
      FIREBASE_PRIVATE_KEY: "test-private-key",
      FIREBASE_STORAGE_BUCKET: "test-project.firebasestorage.app",
      STRIPE_SECRET_KEY: "sk_test_example",
      STRIPE_WEBHOOK_SECRET: "whsec_test",
      STRIPE_PRICE_MOBILE_MONTHLY: "price_monthly",
      STRIPE_PRICE_POLYGLOT_PERMANENT: "price_polyglot",
      STRIPE_PRICE_PREMIUM_LIFETIME: "price_premium",
      STRIPE_COUPON_LEGACY_DESKTOP_50: "coupon_legacy",
      STRIPE_SUCCESS_URL: "https://test.example.com/account/?checkout=success&session_id={CHECKOUT_SESSION_ID}",
      STRIPE_CANCEL_URL: "https://test.example.com/account/?checkout=cancelled",
      STRIPE_PORTAL_RETURN_URL: "https://test.example.com/account/",
      PUBLIC_APP_ORIGIN: "https://test.example.com"
    });
    const health = await healthHandler({ ...event(), httpMethod: "GET" }, {} as never);
    expect(JSON.parse(String(health?.body))).toMatchObject({
      status: "ready_for_stripe_canary",
      readiness: { accountTesting: true, stripeConfigured: true, checkoutTesting: false },
      safeMode: true,
      controls: { STRIPE_MUTATIONS_ENABLED: false, STRIPE_WEBHOOKS_ENABLED: false },
      configuration: { firebaseAdmin: true, firebaseWeb: true, stripeTest: true }
    });
  });

  it("reports checkout testing only while both isolated Stripe canary switches are enabled", async () => {
    Object.assign(process.env, {
      FIREBASE_WEB_API_KEY: "public-firebase-web-test-key",
      FIREBASE_AUTH_DOMAIN: "test-project.firebaseapp.com",
      FIREBASE_PROJECT_ID: "test-project",
      FIREBASE_CLIENT_EMAIL: "firebase-admin@test-project.iam.gserviceaccount.com",
      FIREBASE_PRIVATE_KEY: "test-private-key",
      FIREBASE_STORAGE_BUCKET: "test-project.firebasestorage.app",
      STRIPE_SECRET_KEY: "rk_test_example",
      STRIPE_WEBHOOK_SECRET: "whsec_test",
      STRIPE_PRICE_MOBILE_MONTHLY: "price_monthly",
      STRIPE_PRICE_POLYGLOT_PERMANENT: "price_polyglot",
      STRIPE_PRICE_PREMIUM_LIFETIME: "price_premium",
      STRIPE_COUPON_LEGACY_DESKTOP_50: "coupon_legacy",
      STRIPE_SUCCESS_URL: "https://test.example.com/account/?checkout=success&session_id={CHECKOUT_SESSION_ID}",
      STRIPE_CANCEL_URL: "https://test.example.com/account/?checkout=cancelled",
      STRIPE_PORTAL_RETURN_URL: "https://test.example.com/account/",
      PUBLIC_APP_ORIGIN: "https://test.example.com",
      STRIPE_MUTATIONS_ENABLED: "true",
      STRIPE_WEBHOOKS_ENABLED: "true"
    });
    const health = await healthHandler({ ...event(), httpMethod: "GET" }, {} as never);
    expect(JSON.parse(String(health?.body))).toMatchObject({
      status: "ready_for_checkout_testing",
      readiness: { accountTesting: true, stripeConfigured: true, checkoutTesting: true },
      safeMode: false,
      controls: { STRIPE_MUTATIONS_ENABLED: true, STRIPE_WEBHOOKS_ENABLED: true },
      configuration: { stripeTest: true }
    });
  });

  it("does not report Stripe ready when checkout return URLs are missing", async () => {
    Object.assign(process.env, {
      FIREBASE_WEB_API_KEY: "public-firebase-web-test-key",
      FIREBASE_AUTH_DOMAIN: "test-project.firebaseapp.com",
      FIREBASE_PROJECT_ID: "test-project",
      FIREBASE_CLIENT_EMAIL: "firebase-admin@test-project.iam.gserviceaccount.com",
      FIREBASE_PRIVATE_KEY: "test-private-key",
      FIREBASE_STORAGE_BUCKET: "test-project.firebasestorage.app",
      STRIPE_SECRET_KEY: "sk_test_example",
      STRIPE_WEBHOOK_SECRET: "whsec_test",
      STRIPE_PRICE_MOBILE_MONTHLY: "price_monthly",
      STRIPE_PRICE_POLYGLOT_PERMANENT: "price_polyglot",
      STRIPE_PRICE_PREMIUM_LIFETIME: "price_premium",
      STRIPE_COUPON_LEGACY_DESKTOP_50: "coupon_legacy"
    });
    const health = await healthHandler({ ...event(), httpMethod: "GET" }, {} as never);
    expect(JSON.parse(String(health?.body))).toMatchObject({
      status: "ready_for_account_testing",
      readiness: { accountTesting: true, stripeConfigured: false, checkoutTesting: false },
      configuration: { stripeTest: false }
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
