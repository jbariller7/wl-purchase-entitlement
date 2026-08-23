import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HandlerEvent } from "@netlify/functions";

vi.mock("../src/providers/apple/service.js", () => ({
  verifyAppleNotification: vi.fn(() => { throw new Error("Apple SDK must not be called while disabled."); }),
  processAppleNotification: vi.fn()
}));
vi.mock("../src/providers/google-play/rtdn.js", () => ({
  verifyPubSubAuthorization: vi.fn(() => { throw new Error("Google SDK must not be called while disabled."); }),
  parseRtdn: vi.fn(),
  processRtdn: vi.fn()
}));
import { handler as appleHandler } from "../netlify/functions/apple-webhook.js";
import { handler as googlePlayHandler } from "../netlify/functions/google-play-webhook.js";
import { handler as healthHandler } from "../netlify/functions/health.js";
import { handler as outboxHandler } from "../netlify/functions/outbox-worker.js";
import { handler as stripeHandler } from "../netlify/functions/stripe-webhook.js";
import { resetEnvironmentForTests } from "../src/config/env.js";

const original = { ...process.env };
const credentialKeys = [
  "FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY", "FIREBASE_STORAGE_BUCKET",
  "FIREBASE_WEB_API_KEY", "FIREBASE_AUTH_DOMAIN", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_MOBILE_MONTHLY", "STRIPE_PRICE_MOBILE_LIFETIME", "STRIPE_COUPON_LEGACY_DESKTOP_50"
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
    OUTBOX_PROCESSING_ENABLED: "false"
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

  it("reports safe mode without requiring or exposing credentials", async () => {
    const response = await healthHandler({ ...event(), httpMethod: "GET" }, {} as never);
    expect(response).toMatchObject({ statusCode: 200 });
    const body = JSON.parse(String(response?.body));
    expect(body).toMatchObject({ status: "configuration_required", environment: "test", safeMode: true });
    expect(body.configuration).toMatchObject({ firebaseAdmin: false, stripeTest: false });
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE_KEY|SECRET_KEY|ACCESS_TOKEN/);
  });
});
