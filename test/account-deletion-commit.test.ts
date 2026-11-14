import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_DELETION_CONFIRMATION, AccountDeletionService } from "../src/account-deletion/service.js";
import { sha256 } from "../src/infrastructure/ids.js";

vi.mock("../src/device-sign-in/service.js", () => ({ invalidateDeviceSignInsForUid: vi.fn() }));

// In-memory transaction commits all writes together, or none on a thrown error.
function fixture() {
  type Row = Record<string, unknown>;
  const rows = new Map<string, Row>();
  const collection = (name: string) => ({
    doc(id: string) {
      const path = name + "/" + id;
      return { id, path, get: async () => ({ exists: rows.has(path), data: () => rows.get(path) }),
        create: async (row: Row) => { if (rows.has(path)) throw Error("duplicate"); rows.set(path, row); } };
    },
    add: vi.fn()
  });
  type Ref = ReturnType<ReturnType<typeof collection>["doc"]>;
  const db = { collection, runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const writes = new Map<string, Row>();
    const result = await fn({ get: (ref: Ref) => ref.get(),
      set: (ref: Ref, data: Row) => writes.set(ref.path, data),
      update: (ref: Ref, data: Row) => writes.set(ref.path, { ...rows.get(ref.path), ...data }) });
    writes.forEach((value, key) => rows.set(key, value));
    return result;
  } };
  const auth = { updateUser: vi.fn(), revokeRefreshTokens: vi.fn() };
  const service = new AccountDeletionService(db as unknown as Firestore, auth as unknown as Auth);
  return { rows, service, auth };
}

describe("account deletion", () => {
  const now = new Date("2026-11-14T09:00:00Z");
  it("only schedules after confirmation by the preview owner and before expiry", async () => {
    const { service, rows, auth } = fixture();
    const preview = await service.preview("player", now);
    const input = { uid: "player", previewId: String(preview.previewId), confirmationPhrase: ACCOUNT_DELETION_CONFIRMATION, now };
    await expect(service.commit({ ...input, uid: "other" })).rejects.toThrow(/another account/);
    await expect(service.commit({ ...input, confirmationPhrase: "" })).rejects.toThrow(/confirm/);
    await expect(service.commit({ ...input, now: new Date(now.getTime() + 16 * 60_000) })).rejects.toThrow(/expired/);
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect([...rows.keys()].every(key => key.startsWith("accountDeletionPreviews/"))).toBe(true);
  });
  it("keeps a durable job and anonymous receipt on interruption, retries without moving the due date", async () => {
    const { service, rows, auth } = fixture();
    const preview = await service.preview("player", now);
    const input = { uid: "player", previewId: String(preview.previewId), confirmationPhrase: ACCOUNT_DELETION_CONFIRMATION, now };
    auth.updateUser.mockRejectedValueOnce(Error("connection lost"));
    await expect(service.commit(input)).rejects.toThrow("connection lost");
    const receipt = rows.get("accountDeletionReceipts/" + sha256(String(preview.receipt)));
    expect(receipt).toMatchObject({ state: "scheduled", deleteAfter: "2026-12-14T09:00:00.000Z" });
    expect(receipt).not.toHaveProperty("uid");
    const second = await service.commit({ ...input, now: new Date(now.getTime() + 60_000) });
    expect(second.deleteAfter).toBe(receipt?.deleteAfter);
    const jobs = [...rows].filter(([key]) => key.startsWith("outbox/"));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.[1]).toMatchObject({ notBefore: receipt?.deleteAfter, kind: "delete_account_data", payload: { uid: "player" } });
  });
});
