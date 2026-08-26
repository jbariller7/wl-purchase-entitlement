import { describe, expect, it, vi } from "vitest";
import { AdminOperationsService } from "../src/admin/operations-service.js";

function snapshot(rows: Array<{ id: string; data: Record<string, unknown> }>) {
  return { docs: rows.map((row) => ({ id: row.id, data: () => row.data })) };
}

describe("administrator audit history", () => {
  it("includes the immutable one-time bootstrap grant beside ordinary administrator actions", async () => {
    const standard = snapshot([{
      id: "audit_regular",
      data: {
        actorUid: "admin_uid",
        actorEmail: "owner@example.com",
        action: "customer.grant.create",
        targetType: "user",
        targetId: "customer_uid",
        summary: "Granted test access",
        createdAt: "2026-08-26T03:00:00.000Z"
      }
    }]);
    const bootstrap = snapshot([{
      id: "audit_bootstrap",
      data: {
        actorUid: "owner_uid",
        targetUid: "owner_uid",
        targetEmail: "jonathan@wonderlang.app",
        action: "admin_claim.set",
        state: "completed",
        signInProvider: "google.com",
        createdAt: "2026-08-26T02:30:00.000Z",
        completedAt: "2026-08-26T02:30:01.000Z"
      }
    }]);
    const db = {
      collection: vi.fn((name: string) => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => ({
            get: vi.fn(async () => name === "adminAudit" ? standard : bootstrap)
          }))
        }))
      }))
    };

    const result = await new AdminOperationsService(db as never, {} as never).audit(100) as {
      entries: Array<Record<string, unknown>>;
    };

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({ id: "audit_regular", action: "customer.grant.create" });
    expect(result.entries[1]).toMatchObject({
      id: "audit_bootstrap",
      actorEmail: "jonathan@wonderlang.app",
      action: "admin_claim.set",
      targetType: "user",
      targetId: "owner_uid",
      summary: "Initial administrator claim completed",
      metadata: { state: "completed", signInProvider: "google.com" }
    });
  });
});
