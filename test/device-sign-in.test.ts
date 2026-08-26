import { describe, expect, it, vi } from "vitest";
import type { Auth, DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import {
  approveDeviceSession,
  consumeDeviceSession,
  currentDeviceSessionGeneration,
  deleteDeviceSignInSessionsForUid,
  deleteExpiredDeviceSignInSessions,
  DeviceSignInService,
  deviceSessionDocumentId,
  formatDeviceUserCode,
  invalidateDeviceSignInsForUid,
  leaseDeviceSession,
  normalizeDeviceUserCode,
  readDeviceSessionSecurityState,
  requireBrowserApprovalSecret,
  requireAuthenticationAfterSessionRevocation,
  requireCurrentDeviceSessionGeneration,
  rotateDeviceSessionGeneration,
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
    const approved = approveDeviceSession(pending(), "uid-one", 7, now);
    expect(approved).toMatchObject({ state: "approved", approvedUid: "uid-one", deviceSessionGeneration: 7 });
    expect(approveDeviceSession(approved, "uid-one", 7, new Date(now.getTime() + 1_000))).toEqual(approved);
    expect(() => approveDeviceSession(approved, "uid-two", 7, now)).toThrow("another WonderLang account");
  });

  it("never leases an unapproved session or one with the wrong polling secret", () => {
    expect(leaseDeviceSession(pending(), sha256(secret), "issue-one", now).lease).toEqual({ state: "pending", retryAfterSeconds: 3 });
    expect(() => leaseDeviceSession(pending(), sha256("wrong-secret"), "issue-one", now)).toThrow("code or polling secret is invalid");
  });

  it("authorizes the automatic browser handoff only with its separate one-time secret", () => {
    const browserSecret = "B".repeat(43);
    const session = pending({ browserApprovalSecretHash: sha256(browserSecret) });
    expect(() => requireBrowserApprovalSecret(session, browserSecret)).not.toThrow();
    expect(() => requireBrowserApprovalSecret(session, "C".repeat(43))).toThrow("invalid or expired");
    expect(() => requireBrowserApprovalSecret(pending(), browserSecret)).toThrow("invalid or expired");
  });

  it("leases an approved session once and removes its UID after token issuance", () => {
    const approved = approveDeviceSession(pending(), "uid-one", 3, now);
    const leased = leaseDeviceSession(approved, sha256(secret), "issue-one", new Date(now.getTime() + 1_000));
    expect(leased.lease).toEqual({
      state: "issuing",
      uid: "uid-one",
      issuanceId: "issue-one",
      deviceSessionGeneration: 3,
      retryAfterSeconds: 0
    });
    expect(leaseDeviceSession(leased.session, sha256(secret), "issue-two", new Date(now.getTime() + 2_000)).lease)
      .toEqual({ state: "pending", retryAfterSeconds: 3 });
    const consumed = consumeDeviceSession(leased.session, "issue-one", new Date(now.getTime() + 3_000));
    expect(consumed.state).toBe("consumed");
    expect(consumed).not.toHaveProperty("approvedUid");
    expect(consumed).not.toHaveProperty("issuanceId");
  });

  it("recovers an abandoned issuance lease after thirty seconds", () => {
    const approved = approveDeviceSession(pending(), "uid-one", 0, now);
    const first = leaseDeviceSession(approved, sha256(secret), "issue-one", now);
    const recovered = leaseDeviceSession(first.session, sha256(secret), "issue-two", new Date(now.getTime() + 31_000));
    expect(recovered.lease).toMatchObject({ state: "issuing", issuanceId: "issue-two", uid: "uid-one" });
  });

  it("rejects expired and consumed sessions", () => {
    const expired = pending({ expiresAt: now.toISOString() });
    expect(() => approveDeviceSession(expired, "uid-one", 0, now)).toThrow("expired");
    expect(() => leaseDeviceSession({ ...pending(), state: "consumed" }, sha256(secret), "issue", now)).toThrow("already completed");
  });

  it("stores only hashes while placing the automatic browser secret in a non-request URL fragment", async () => {
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
    const verificationUrl = new URL(result.verificationUrl);
    const handoff = new URLSearchParams(verificationUrl.hash.slice(1)).get("desktop_sign_in");
    expect(`${verificationUrl.origin}${verificationUrl.pathname}`).toBe("https://wonderlang.net/account/");
    expect(verificationUrl.search).toBe("");
    expect(handoff).toMatch(new RegExp(`^${result.userCode}\\.[A-Za-z0-9_-]{43}$`));
    expect(writes).toHaveLength(1);
    expect(writes[0]?.data.deviceLabel).toBe("Jonathan's PC");
    expect(writes[0]?.data.pollSecretHash).toBe(sha256(result.pollSecret));
    expect(writes[0]?.data.browserApprovalSecretHash).toBe(sha256(handoff!.split(".")[1]!));
    expect(JSON.stringify(writes[0])).not.toContain(result.pollSecret);
    expect(JSON.stringify(writes[0])).not.toContain(handoff!.split(".")[1]);
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

  it("rotates the server-side generation and records the Firebase authentication cutoff", async () => {
    let securityData: Record<string, unknown> = { deviceSessionGeneration: 4 };
    const ref = { path: "accountSecurity/uid-one" };
    const db = {
      collection: (name: string) => {
        expect(name).toBe("accountSecurity");
        return { doc: (uid: string) => { expect(uid).toBe("uid-one"); return ref; } };
      },
      runTransaction: async (callback: (transaction: {
        get: () => Promise<{ data: () => Record<string, unknown> }>;
        set: (_ref: unknown, data: Record<string, unknown>, options: { merge: boolean }) => void;
      }) => Promise<number>) => callback({
        get: async () => ({ data: () => securityData }),
        set: (_securityRef, data, options) => {
          expect(options).toEqual({ merge: true });
          securityData = { ...securityData, ...data };
        }
      })
    } as unknown as Firestore;

    await expect(rotateDeviceSessionGeneration(db, "uid-one", now)).resolves.toBe(5);
    expect(securityData).toMatchObject({
      deviceSessionGeneration: 5,
      sessionsRevokedAuthTime: Math.floor(now.getTime() / 1000),
      sessionsRevokedAt: now.toISOString()
    });
    expect(readDeviceSessionSecurityState(securityData)).toEqual({
      deviceSessionGeneration: 5,
      sessionsRevokedAuthTime: Math.floor(now.getTime() / 1000)
    });
  });

  it("invalidates approved codes before rotating the account generation", async () => {
    const operations: string[] = [];
    const securityRef = { path: "accountSecurity/uid-one" };
    const db = {
      collection: (name: string) => {
        if (name === "deviceSignInSessions") {
          return {
            where: () => ({
              limit: () => ({
                get: async () => {
                  operations.push("delete-approved-codes");
                  return { empty: true, size: 0, docs: [] };
                }
              })
            })
          };
        }
        return { doc: () => securityRef };
      },
      runTransaction: async (callback: (transaction: {
        get: () => Promise<{ data: () => Record<string, unknown> }>;
        set: () => void;
      }) => Promise<number>) => callback({
        get: async () => ({ data: () => ({ deviceSessionGeneration: 0 }) }),
        set: () => { operations.push("rotate-generation"); }
      })
    } as unknown as Firestore;

    await expect(invalidateDeviceSignInsForUid(db, "uid-one", now)).resolves.toEqual({
      canceledDeviceSignIns: 0,
      deviceSessionGeneration: 1
    });
    expect(operations).toEqual(["delete-approved-codes", "rotate-generation"]);
  });

  it("rejects stale Firebase authentication when an approval races session revocation", () => {
    const revokedAt = Math.floor(now.getTime() / 1000);
    const state = { deviceSessionGeneration: 2, sessionsRevokedAuthTime: revokedAt };
    expect(() => requireAuthenticationAfterSessionRevocation(state, revokedAt - 1)).toThrow("session was revoked");
    expect(() => requireAuthenticationAfterSessionRevocation(state, revokedAt)).toThrow("session was revoked");
    expect(() => requireAuthenticationAfterSessionRevocation(state, revokedAt + 1)).not.toThrow();
  });

  it("fails closed on malformed server-side session security state", () => {
    expect(() => readDeviceSessionSecurityState({ deviceSessionGeneration: "1" })).toThrow("generation is invalid");
    expect(() => readDeviceSessionSecurityState({ sessionsRevokedAuthTime: 1.5 })).toThrow("cutoff is invalid");
  });

  it("rejects a custom token exchanged after sign-out-all when its generation is stale", async () => {
    const db = {
      collection: (name: string) => {
        expect(name).toBe("accountSecurity");
        return {
          doc: (uid: string) => {
            expect(uid).toBe("uid-one");
            return { get: async () => ({ data: () => ({ deviceSessionGeneration: 1 }) }) };
          }
        };
      }
    } as unknown as Firestore;
    const staleToken = {
      uid: "uid-one",
      wlDeviceSignIn: true,
      wlDeviceSessionGeneration: 0
    } as unknown as DecodedIdToken;
    const currentToken = { ...staleToken, wlDeviceSessionGeneration: 1 } as unknown as DecodedIdToken;
    const ordinaryWebToken = { uid: "uid-one" } as unknown as DecodedIdToken;

    await expect(requireCurrentDeviceSessionGeneration(db, staleToken)).rejects.toThrow("session was revoked");
    await expect(requireCurrentDeviceSessionGeneration(db, currentToken)).resolves.toBeUndefined();
    await expect(requireCurrentDeviceSessionGeneration(db, ordinaryWebToken)).resolves.toBeUndefined();
    await expect(currentDeviceSessionGeneration(db, "uid-one")).resolves.toBe(1);
  });

  it("mints PC/Mac custom tokens with the generation bound at approval", async () => {
    let session = approveDeviceSession(pending(), "uid-one", 9, now);
    const sessionRef = { kind: "session" };
    const securityRef = {
      kind: "security",
      get: async () => ({ data: () => ({ deviceSessionGeneration: 9 }) })
    };
    const db = {
      collection: (name: string) => ({
        doc: () => name === "deviceSignInSessions" ? sessionRef : securityRef
      }),
      runTransaction: async (callback: (transaction: {
        get: (ref: { kind: string }) => Promise<{ exists: boolean; data: () => DeviceSignInSession }>;
        set: (ref: { kind: string }, data: DeviceSignInSession) => void;
        update: () => void;
        delete: () => void;
      }) => Promise<unknown>) => callback({
        get: async () => ({ exists: true, data: () => session }),
        set: (_ref, data) => { session = data; },
        update: () => undefined,
        delete: () => undefined
      })
    } as unknown as Firestore;
    const createCustomToken = vi.fn(async () => "custom-token");
    const service = new DeviceSignInService(db, { createCustomToken } as unknown as Auth);

    await expect(service.poll({ userCode: "ABCD-2345", pollSecret: secret, now: new Date(now.getTime() + 1_000) }))
      .resolves.toEqual({ state: "authorized", customToken: "custom-token" });
    expect(createCustomToken).toHaveBeenCalledWith("uid-one", {
      wlDeviceSignIn: true,
      wlDeviceSessionGeneration: 9
    });
    expect(session.state).toBe("consumed");
  });
});
