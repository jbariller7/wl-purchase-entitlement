import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeImportRows } from "../src/admin/import-service.js";
import {
  cloudObjectMatches,
  cloudProfileRevisionObjectPath,
  cloudProfileStagingObjectPath,
  cloudRevisionConflicts,
  retainedCloudRevisionPlan
} from "../src/cloud-save/profile-service.js";
import { cloudSaveCleanupRetryAt, isSafeCloudRevisionObjectPath } from "../src/cloud-save/cleanup-service.js";
import { providerEventDecision } from "../src/domain/provider-event.js";
import { assertWebsiteStripeCheckoutProduct, checkoutRequestSchema } from "../src/providers/stripe/checkout-service.js";
import { assertWebsiteStripePriceKind } from "../src/admin/billing-service.js";
import { safeErrorMessage } from "../src/infrastructure/safe-error.js";

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

describe("operational error redaction", () => {
  it("removes customer identity and secret material before logs or retry records", () => {
    const stripeSecret = ["sk", "test", "1234567890ABCDEFGHIJKLMNOP"].join("_");
    const googleApiKey = ["AI", "zaSyDUMMYDUMMYDUMMYDUMMY12"].join("");
    const message = safeErrorMessage(new Error(
      `buyer@example.com Bearer abc.def ${stripeSecret} ${googleApiKey}`
    ));
    expect(message).not.toContain("buyer@example.com");
    expect(message).not.toContain("abc.def");
    expect(message).not.toContain("sk_test_");
    expect(message).not.toContain("AIza");
    expect(message).toContain("[redacted-email]");
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

  it("keeps profile staging uploads separate from immutable revisions", () => {
    const uid = "firebase-user";
    const uploadId = "4acb303f-18d2-4b98-b665-058c332271df";
    const staging = cloudProfileStagingObjectPath(uid, uploadId);
    const revision = cloudProfileRevisionObjectPath(uid, "default", uploadId);
    expect(staging).toBe(`cloud-save-profile-uploads/${uid}/${uploadId}.json`);
    expect(revision).toBe(`cloud-save-profiles/${uid}/profiles/default/revisions/${uploadId}.json`);
    expect(staging).not.toBe(revision);
    expect(() => cloudProfileRevisionObjectPath(uid, "outside", uploadId)).toThrow(/profile ID/);
  });

  it("retains three predecessors for the new current revision and schedules older objects for deletion", () => {
    const pointers = [0, 1, 2, 3].map((index) => ({
      revision: `00000000-0000-4000-8000-00000000000${index}`,
      objectPath: `cloud-save-profiles/user/profiles/default/revisions/00000000-0000-4000-8000-00000000000${index}.json`,
      updatedAt: new Date(now.getTime() - index * 1000).toISOString()
    }));
    const plan = retainedCloudRevisionPlan({
      currentRevision: pointers[0]!.revision,
      objectPath: pointers[0]!.objectPath,
      updatedAt: pointers[0]!.updatedAt,
      previousRevisions: pointers.slice(1)
    });
    expect(plan.retained).toEqual(pointers.slice(0, 3));
    expect(plan.prunedObjectPaths).toEqual([pointers[3]!.objectPath]);
  });

  it("only deletes immutable revision paths and backs retries off", () => {
    const revision = "cloud-save-profiles/user/profiles/default/revisions/4acb303f-18d2-4b98-b665-058c332271df.json";
    expect(isSafeCloudRevisionObjectPath(revision)).toBe(true);
    expect(isSafeCloudRevisionObjectPath(revision, "user")).toBe(true);
    expect(isSafeCloudRevisionObjectPath(revision, "another-user")).toBe(false);
    expect(isSafeCloudRevisionObjectPath("cloud-save-profile-uploads/user/4acb303f-18d2-4b98-b665-058c332271df.json")).toBe(false);
    expect(isSafeCloudRevisionObjectPath("cloud-save-profiles/user/profiles/outside/revisions/4acb303f-18d2-4b98-b665-058c332271df.json")).toBe(false);
    expect(isSafeCloudRevisionObjectPath("../outside.json")).toBe(false);
    expect(cloudSaveCleanupRetryAt(1, now)).toBe("2026-08-24T12:00:30.000Z");
    expect(cloudSaveCleanupRetryAt(2, now)).toBe("2026-08-24T12:01:00.000Z");
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

  it("preserves the selected mobile platform for entitlement projection", () => {
    const [normalized] = normalizeImportRows([{
      ...row,
      kind: "mobile_polyglot_permanent",
      mobilePlatform: "ios"
    }], now);
    expect(normalized?.mobilePlatform).toBe("ios");
  });

  it("requires the original mobile platform for a historical chapter upgrade", () => {
    expect(() => normalizeImportRows([{
      ...row,
      kind: "legacy_chapter_1",
      startsAt: "2026-08-01T00:00:00.000Z"
    }], now)).toThrow(/Choose Android or iOS/);

    expect(normalizeImportRows([{
      ...row,
      kind: "legacy_chapter_1",
      mobilePlatform: "android",
      startsAt: "2026-08-01T00:00:00.000Z"
    }], now)[0]).toMatchObject({ kind: "legacy_chapter_1", mobilePlatform: "android" });
  });
});

describe("new checkout product contract", () => {
  it("requires both the first mobile platform and PC/Mac delivery for Premium", () => {
    expect(checkoutRequestSchema.safeParse({ product: "premium_lifetime_pass", mobilePlatform: "android" }).success).toBe(false);
    expect(checkoutRequestSchema.safeParse({ product: "premium_lifetime_pass", mobilePlatform: "ios", desktopDelivery: "steam" }).success).toBe(true);
    expect(checkoutRequestSchema.safeParse({ product: "premium_lifetime_pass", mobilePlatform: "android", desktopDelivery: "direct" }).success).toBe(true);
  });

  it("rejects native-only products even when a crafted client supplies otherwise valid fields", () => {
    for (const request of [
      { product: "mobile_polyglot_permanent", mobilePlatform: "android" },
      { product: "mobile_full_monthly" }
    ]) {
      const result = checkoutRequestSchema.safeParse(request);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.map((issue) => issue.message).join(" ")).toMatch(/sold only inside the Android and iOS apps/i);
    }
    expect(() => assertWebsiteStripeCheckoutProduct("mobile_full_monthly")).toThrow(/sold only inside/i);
    expect(() => assertWebsiteStripeCheckoutProduct("mobile_polyglot_permanent")).toThrow(/sold only inside/i);
    expect(() => assertWebsiteStripeCheckoutProduct("premium_lifetime_pass")).not.toThrow();
  });

  it("allows Admin Stripe price mutations only for website-only Premium", () => {
    expect(() => assertWebsiteStripePriceKind("monthly")).toThrow(/managed in Google Play and App Store Connect/i);
    expect(() => assertWebsiteStripePriceKind("polyglot")).toThrow(/managed in Google Play and App Store Connect/i);
    expect(() => assertWebsiteStripePriceKind("premium")).not.toThrow();
  });
});
