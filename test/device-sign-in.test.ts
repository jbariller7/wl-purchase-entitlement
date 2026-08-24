import { describe, expect, it } from "vitest";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import {
  approveDeviceSession,
  consumeDeviceSession,
  deleteDeviceSignInSessionsForUid,
  deleteExpiredDeviceSignInSessions,
  DeviceSignInService,
  deviceSessionDocumentId,
  formatDeviceUserCode,
  leaseDeviceSession,
  normalizeDeviceUserCode,
  type DeviceSignInSession
} from "../src/device-sign-in/service.js";
import { sha256 } from "../src/infrastructure/ids.js";

const now = new Date("2026-08-25T00:00:00.000Z");
const secret = "test-poll-secret";

function pending(overrides: Partial<DeviceSignInSession> = {}): DeviceSignInSession {
  return {
    state: "pending",
    pollSecretHash: sha256(secret),
    deviceLabel: "WonderLang PC",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    ...overrides
  };
}

describe("PC/Mac device authorization", () => {
  it("normalizes an unambiguous eight-character display code", () => {
    expect(normalizeDeviceUserCode("abcd-2345")).toBe("ABCD2345");
    expect(formatDeviceUserCode("ABCD2345")).toBe("ABCD-2345");
    expect(deviceSessionDocumentId("ABCD-2345")).toMatch(/^[a-f0-9]{64}$/);
    expect(() => normalizeDeviceUserCode("ABCI-2345")).toThrow("eight-character device code");
  });

  it("approves only the intended Firebase UID and remains idempotent for it", () => {
    const approved = approveDeviceSession(pending(), "uid-one", now);
    expect(approved).toMatchObject({ state: "approved", approvedUid: "uid-one" });
    expect(approveDeviceSession(approved, "uid-one", new Date(now.getTime() + 1_000))).toEqual(approved);
    expect(() => approveDeviceSession(approved, "uid-two", now)).toThrow("another WonderLang account");
  });

  it("never leases an unapproved session or one with the wrong polling secret", () => {
    expect(leaseDeviceSession(pending(), sha256(secret), "issue-one", now).lease).toEqual({ state: "pending", retryAfterSeconds: 3 });
    expect(() => leaseDeviceSession(pending(), sha256("wrong-secret"), "issue-one", now)).toThrow("code or polling secret is invalid");
  });

  it("leases an approved session once and removes its UID after token issuance", () => {
    const approved = approveDeviceSession(pending(), "uid-one", now);
    const leased = leaseDeviceSession(approved, sha256(secret), "issue-one", new Date(now.getTime() + 1_000));
    expect(leased.lease).toEqual({ state: "issuing", uid: "uid-one", issuanceId: "issue-one", retryAfterSeconds: 0 });
    expect(leaseDeviceSession(leased.session, sha256(secret), "issue-two", new Date(now.getTime() + 2_000)).lease)
      .toEqual({ state: "pending", retryAfterSeconds: 3 });
    const consumed = consumeDeviceSession(leased.session, "issue-one", new Date(now.getTime() + 3_000));
    expect(consumed.state).toBe("consumed");
    expect(consumed).not.toHaveProperty("approvedUid");
    expect(consumed).not.toHaveProperty("issuanceId");
  });

  it("recovers an abandoned issuance lease after thirty seconds", () => {
    const approved = approveDeviceSession(pending(), "uid-one", now);
    const first = leaseDeviceSession(approved, sha256(secret), "issue-one", now);
    const recovered = leaseDeviceSession(first.session, sha256(secret), "issue-two", new Date(now.getTime() + 31_000));
    expect(recovered.lease).toMatchObject({ state: "issuing", issuanceId: "issue-two", uid: "uid-one" });
  });

  it("rejects expired and consumed sessions", () => {
    const expired = pending({ expiresAt: now.toISOString() });
    expect(() => approveDeviceSession(expired, "uid-one", now)).toThrow("expired");
    expect(() => leaseDeviceSession({ ...pending(), state: "consumed" }, sha256(secret), "issue", now)).toThrow("already completed");
  });

  it("stores only the polling-secret hash when starting a session", async () => {
    const writes: Array<{ id: string; data: DeviceSignInSession }> = [];
    const db = {
      collection: () => ({
        doc: (id: string) => ({
          create: async (data: DeviceSignInSession) => { writes.push({ id, data }); }
        })
      })
    } as unknown as Firestore;
    const service = new DeviceSignInService(db, {} as Auth);
    const result = await service.start({ deviceLabel: "  Jonathan's\nPC  ", now, publicAppOrigin: "https://wonderlang.net" });
    expect(result.userCode).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    expect(result.pollSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.verificationUrl).toContain("https://wonderlang.net/account/?device_code=");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.data.deviceLabel).toBe("Jonathan's PC");
    expect(writes[0]?.data.pollSecretHash).toBe(sha256(result.pollSecret));
    expect(JSON.stringify(writes[0])).not.toContain(result.pollSecret);
  });

  it("deletes approved account sessions and expired anonymous sessions in bounded batches", async () => {
    const queries: Array<[string, string, string]> = [];
    const deleted: string[] = [];
    let snapshots = [
      { empty: false, size: 2, docs: [{ ref: { path: "deviceSignInSessions/a" } }, { ref: { path: "deviceSignInSessions/b" } }] },
      { empty: true, size: 0, docs: [] },
      { empty: false, size: 1, docs: [{ ref: { path: "deviceSignInSessions/c" } }] },
      { empty: true, size: 0, docs: [] }
    ];
    const db = {
      collection: () => ({
        where: (field: string, operator: string, value: string) => {
          queries.push([field, operator, value]);
          return { limit: () => ({ get: async () => snapshots.shift() }) };
        }
      }),
      batch: () => ({
        delete: (ref: { path: string }) => { deleted.push(ref.path); },
        commit: async () => undefined
      })
    } as unknown as Firestore;
    expect(await deleteDeviceSignInSessionsForUid(db, "uid-one")).toBe(2);
    expect(await deleteExpiredDeviceSignInSessions(db, now)).toBe(1);
    expect(queries[0]).toEqual(["approvedUid", "==", "uid-one"]);
    expect(queries[2]).toEqual(["expiresAt", "<=", now.toISOString()]);
    expect(deleted).toEqual(["deviceSignInSessions/a", "deviceSignInSessions/b", "deviceSignInSessions/c"]);
  });
});
