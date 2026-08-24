import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeImportRows } from "../src/admin/import-service.js";
import { cloudObjectMatches, cloudRevisionConflicts } from "../src/cloud-save/service.js";
import { providerEventDecision } from "../src/domain/provider-event.js";
import { checkoutRequestSchema } from "../src/providers/stripe/checkout-service.js";

const now = new Date("2026-08-24T12:00:00.000Z");

describe("provider webhook replay policy", () => {
  it("accepts new, failed, released, and stale-processing events for idempotent processing", () => {
    expect(providerEventDecision(undefined, now)).toBe("process");
    expect(providerEventDecision({ status: "failed", lastAttemptAt: "2026-08-24T11:59:00.000Z" }, now)).toBe("process");
    expect(providerEventDecision({ status: "released", lastAttemptAt: "2026-08-24T11:59:00.000Z" }, now)).toBe("process");
    expect(providerEventDecision({ status: "processing", lastAttemptAt: "2026-08-24T11:54:59.000Z" }, now)).toBe("process");
  });

  it("rejects completed and fresh in-flight duplicates", () => {
    expect(providerEventDecision({ status: "processed" }, now)).toBe("duplicate");
    expect(providerEventDecision({ status: "processing", lastAttemptAt: "2026-08-24T11:59:00.000Z" }, now)).toBe("duplicate");
  });
});

describe("cloud-save integrity and conflict policy", () => {
  const bytes = Buffer.from('{"save":"verified"}');
  const digest = createHash("sha256").update(bytes).digest("hex");

  it("requires both the exact byte count and SHA-256 digest", () => {
    expect(cloudObjectMatches(bytes, { byteLength: bytes.byteLength, sha256: digest })).toBe(true);
    expect(cloudObjectMatches(Buffer.from('{"save":"tampered"}'), { byteLength: bytes.byteLength, sha256: digest })).toBe(false);
    expect(cloudObjectMatches(bytes, { byteLength: bytes.byteLength + 1, sha256: digest })).toBe(false);
  });

  it("treats any divergent base revision as a visible conflict", () => {
    expect(cloudRevisionConflicts(null, null)).toBe(false);
    expect(cloudRevisionConflicts("rev-a", "rev-a")).toBe(false);
    expect(cloudRevisionConflicts(null, "rev-a")).toBe(true);
    expect(cloudRevisionConflicts("rev-a", "rev-b")).toBe(true);
  });
});

describe("purchase import validation and idempotency keys", () => {
  const row = {
    email: "  Person@Example.com ",
    kind: "mobile_lifetime" as const,
    externalId: " order_123 ",
    note: "Historical website purchase"
  };

  it("normalizes exact identity and stable external transaction data", () => {
    expect(normalizeImportRows([row], now)).toEqual([{
      ...row,
      email: "person@example.com",
      externalId: "order_123",
      startsAt: now.toISOString()
    }]);
  });

  it("rejects duplicate provider transaction IDs before applying any row", () => {
    expect(() => normalizeImportRows([row, { ...row, email: "other@example.com" }], now)).toThrow(/Duplicate external ID/);
  });

  it("rejects invalid expiry ordering and malformed email addresses", () => {
    expect(() => normalizeImportRows([{ ...row, startsAt: "2026-08-25T00:00:00Z", endsAt: "2026-08-24T00:00:00Z" }], now)).toThrow(/Invalid endsAt/);
    expect(() => normalizeImportRows([{ ...row, email: "not-an-email" }], now)).toThrow(/Invalid email/);
  });
});

describe("new checkout product contract", () => {
  it("requires both the first mobile platform and PC/Mac delivery for Premium", () => {
    expect(checkoutRequestSchema.safeParse({ product: "premium_lifetime_pass", mobilePlatform: "android" }).success).toBe(false);
    expect(checkoutRequestSchema.safeParse({ product: "premium_lifetime_pass", mobilePlatform: "ios", desktopDelivery: "steam" }).success).toBe(true);
    expect(checkoutRequestSchema.safeParse({ product: "premium_lifetime_pass", mobilePlatform: "android", desktopDelivery: "direct" }).success).toBe(true);
  });

  it("keeps Polyglot mobile-only and Monthly cross-mobile", () => {
    expect(checkoutRequestSchema.safeParse({ product: "mobile_polyglot_permanent" }).success).toBe(false);
    expect(checkoutRequestSchema.safeParse({ product: "mobile_polyglot_permanent", mobilePlatform: "android" }).success).toBe(true);
    expect(checkoutRequestSchema.safeParse({ product: "mobile_full_monthly" }).success).toBe(true);
  });
});
