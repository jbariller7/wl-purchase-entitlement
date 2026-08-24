import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnvironmentForTests } from "../src/config/env.js";
import { decryptProviderToken, encryptProviderToken } from "../src/infrastructure/provider-token-crypto.js";

const original = { ...process.env };
const required = {
  APP_ENVIRONMENT: "test",
  STRIPE_SECRET_KEY: "sk_test_provider_token_crypto",
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

function ring(current: string, keys: Record<string, Buffer>): string {
  return JSON.stringify({
    current,
    keys: Object.fromEntries(Object.entries(keys).map(([id, key]) => [id, key.toString("base64")]))
  });
}

beforeEach(() => {
  Object.assign(process.env, required, {
    PROVIDER_TOKEN_ENCRYPTION_KEYS: ring("staging-v1", { "staging-v1": Buffer.alloc(32, 7) })
  });
  resetEnvironmentForTests();
});

afterEach(() => {
  process.env = { ...original };
  resetEnvironmentForTests();
});

describe("provider subscription token encryption", () => {
  it("round-trips with authenticated metadata without storing plaintext", () => {
    const token = "google-play-purchase-token-secret";
    const aad = "wonderlang:google_play:play_digest:firebase-user";
    const encrypted = encryptProviderToken(token, aad);
    expect(encrypted).toMatchObject({ algorithm: "aes-256-gcm", keyId: "staging-v1" });
    expect(JSON.stringify(encrypted)).not.toContain(token);
    expect(decryptProviderToken(encrypted, aad)).toBe(token);
  });

  it("rejects ciphertext moved to another account or subscription", () => {
    const encrypted = encryptProviderToken("purchase-token", "wonderlang:google_play:play_a:user_a");
    expect(() => decryptProviderToken(encrypted, "wonderlang:google_play:play_b:user_b")).toThrow(/authentication failed/i);
  });

  it("decrypts an old key while new writes use the rotated current key", () => {
    const aad = "wonderlang:google_play:play_digest:firebase-user";
    const old = encryptProviderToken("old-token", aad);
    process.env.PROVIDER_TOKEN_ENCRYPTION_KEYS = ring("staging-v2", {
      "staging-v1": Buffer.alloc(32, 7),
      "staging-v2": Buffer.alloc(32, 9)
    });
    resetEnvironmentForTests();
    expect(decryptProviderToken(old, aad)).toBe("old-token");
    expect(encryptProviderToken("new-token", aad).keyId).toBe("staging-v2");
  });

  it("refuses malformed or incorrectly sized keys", () => {
    process.env.PROVIDER_TOKEN_ENCRYPTION_KEYS = ring("bad", { bad: Buffer.alloc(31, 1) });
    resetEnvironmentForTests();
    expect(() => encryptProviderToken("token", "aad")).toThrow(/exactly 32 bytes/i);
  });
});
