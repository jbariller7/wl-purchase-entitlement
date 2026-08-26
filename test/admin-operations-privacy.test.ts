import { describe, expect, it } from "vitest";
import {
  publicOutboxSummary,
  publicFulfillmentSummary,
  publicGrantSummary,
  publicDeletionRequest,
  publicProviderEventSummary,
  publicReconciliationRunSummary
} from "../src/admin/operations-service.js";

describe("administrator operations privacy projections", () => {
  it("does not return an outbox payload, deduplication key, lease, or secret-bearing error", () => {
    const result = publicOutboxSummary("job-1", {
      kind: "fulfill_legacy_order",
      state: "failed",
      attemptCount: 6,
      createdAt: "2026-08-26T08:00:00.000Z",
      notBefore: "2026-08-26T08:05:00.000Z",
      payload: {
        buyerEmail: "private-player@example.com",
        key: "PRIVATE-STEAM-KEY",
        uid: "private-customer-uid"
      },
      dedupeKey: "fulfillment:private-payment",
      workerId: "private-worker-lease",
      lastError: "Delivery to private-player@example.com failed with sk_test_abcdefghijklmnopqrstuvwxyz"
    });

    expect(result).toEqual({
      id: "job-1",
      kind: "fulfill_legacy_order",
      state: "failed",
      attemptCount: 6,
      createdAt: "2026-08-26T08:00:00.000Z",
      notBefore: "2026-08-26T08:05:00.000Z",
      completedAt: null,
      lastError: "Delivery to [redacted-email] failed with [redacted-secret]"
    });
    const serialized = JSON.stringify(result);
    for (const privateValue of ["payload", "dedupeKey", "workerId", "PRIVATE-STEAM-KEY", "private-customer-uid", "private-player@example.com", "sk_test_"]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("returns only the provider-event fields required by the retry ledger UI", () => {
    const result = publicProviderEventSummary("event-1", {
      provider: "google_play",
      eventType: "SUBSCRIPTION_RENEWED",
      status: "failed",
      attemptCount: 2,
      receivedAt: "2026-08-26T08:00:00.000Z",
      payloadSha256: "a".repeat(64),
      providerEventId: "private-provider-event-id",
      rawPayload: "private-provider-payload",
      lastError: "Account private-player@example.com could not be synchronized."
    });

    expect(result).toEqual({
      id: "event-1",
      provider: "google_play",
      eventType: "SUBSCRIPTION_RENEWED",
      status: "failed",
      attemptCount: 2,
      receivedAt: "2026-08-26T08:00:00.000Z",
      processedAt: null,
      lastError: "Account [redacted-email] could not be synchronized."
    });
    expect(JSON.stringify(result)).not.toContain("private-provider");
  });

  it("keeps reconciliation history aggregate and read-only", () => {
    expect(publicReconciliationRunSummary("run-1", {
      state: "partial",
      startedAt: "2026-08-26T08:00:00.000Z",
      finishedAt: "2026-08-26T08:01:00.000Z",
      bootstrapped: 4,
      attempted: 24,
      succeeded: 23,
      failed: 1,
      providerAccess: "unexpected",
      targets: [{ uid: "private-customer-uid", purchaseToken: "private-token" }]
    })).toEqual({
      id: "run-1",
      state: "partial",
      startedAt: "2026-08-26T08:00:00.000Z",
      finishedAt: "2026-08-26T08:01:00.000Z",
      bootstrapped: 4,
      attempted: 24,
      succeeded: 23,
      failed: 1,
      providerAccess: "read_only",
      lastError: null
    });
  });

  it("reports fulfillment counts without returning Steam or Itch access keys", () => {
    const result = publicFulfillmentSummary("fulfillment-1", {
      orderId: "cs_test_order_1",
      createdAt: "2026-08-26T08:00:00.000Z",
      mirroredToSheetAt: "2026-08-26T08:01:00.000Z",
      syncedToMailerLiteAt: "2026-08-26T08:02:00.000Z",
      keys: [
        { key: "PRIVATE-STEAM-KEY", sheetTab: "Polyglot Steam", rowNumber: 2 },
        { key: "PRIVATE-ITCH-LINK", sheetTab: "Polyglot Itch", rowNumber: 3 }
      ]
    });

    expect(result).toEqual({
      id: "fulfillment-1",
      orderId: "cs_test_order_1",
      createdAt: "2026-08-26T08:00:00.000Z",
      mirroredToSheetAt: "2026-08-26T08:01:00.000Z",
      syncedToMailerLiteAt: "2026-08-26T08:02:00.000Z",
      keyCount: 2
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("PRIVATE-STEAM-KEY");
    expect(serialized).not.toContain("PRIVATE-ITCH-LINK");
    expect(serialized).not.toContain("sheetTab");
    expect(serialized).not.toContain("rowNumber");
  });

  it("keeps only display-safe grant fields and the migration marker", () => {
    const result = publicGrantSummary({
      id: "grant-1",
      uid: "private-customer-uid",
      provider: "google_play",
      providerCustomerId: "private-provider-customer",
      providerTransactionId: "private-provider-transaction",
      providerSubscriptionId: "private-provider-subscription",
      product: "mobile_polyglot_permanent",
      state: "active",
      startsAt: "2026-08-26T08:00:00.000Z",
      metadata: {
        migration: true,
        purchaseTokenHash: "private-purchase-token-hash",
        latestOrderId: "private-order-id"
      }
    });

    expect(result).toEqual({
      id: "grant-1",
      provider: "google_play",
      product: "mobile_polyglot_permanent",
      state: "active",
      startsAt: "2026-08-26T08:00:00.000Z",
      currentPeriodEndsAt: null,
      graceEndsAt: null,
      endsAt: null,
      refundedAt: null,
      metadata: { migration: true }
    });
    const serialized = JSON.stringify(result);
    for (const privateValue of ["private-customer-uid", "private-provider", "private-purchase", "private-order-id"]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("does not expose account-deletion workflow identifiers or internal reasons", () => {
    const result = publicDeletionRequest({
      uid: "private-customer-uid",
      state: "scheduled",
      requestedAt: "2026-08-26T08:00:00.000Z",
      deleteAfter: "2026-09-25T08:00:00.000Z",
      recoveryDays: 30,
      previewId: "private-preview-id",
      canceledBy: "private-admin-uid",
      cancellationReason: "private-support-reason"
    });
    expect(result).toEqual({
      state: "scheduled",
      requestedAt: "2026-08-26T08:00:00.000Z",
      deleteAfter: "2026-09-25T08:00:00.000Z",
      recoveryDays: 30,
      canceledAt: null
    });
    expect(JSON.stringify(result)).not.toContain("private-");
  });
});
