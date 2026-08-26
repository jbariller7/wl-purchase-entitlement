import type { Auth, UserRecord } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";
import { AdminOperationsService } from "../src/admin/operations-service.js";

function googleUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    uid: "player-uid",
    emailVerified: false,
    disabled: false,
    metadata: {
      creationTime: "Mon, 25 Aug 2026 12:00:00 GMT",
      lastSignInTime: "Tue, 26 Aug 2026 12:00:00 GMT",
      lastRefreshTime: null,
      toJSON: () => ({})
    },
    providerData: [{ providerId: "google.com", uid: "google-player", displayName: null, email: null, phoneNumber: null, photoURL: null }],
    tokensValidAfterTime: "Mon, 25 Aug 2026 12:00:00 GMT",
    toJSON: () => ({}),
    ...overrides
  } as UserRecord;
}

function dependencies() {
  const original = googleUser();
  const repaired = googleUser({ email: "jonathan.bariller@gmail.com" });
  const getUser = vi.fn(async () => original);
  const getUserByEmail = vi.fn(async () => { throw Object.assign(new Error("missing"), { code: "auth/user-not-found" }); });
  const updateUser = vi.fn(async () => repaired);
  const revokeRefreshTokens = vi.fn(async () => undefined);
  const create = vi.fn(async () => undefined);
  const auth = { getUser, getUserByEmail, updateUser, revokeRefreshTokens } as unknown as Auth;
  const db = { collection: vi.fn(() => ({ doc: vi.fn(() => ({ id: "audit-1", create })) })) } as unknown as Firestore;
  return { auth, db, getUserByEmail, updateUser, revokeRefreshTokens, create };
}

describe("administrator federated email repair", () => {
  it("binds a missing email without marking it verified, revokes sessions, and audits the operation", async () => {
    const deps = dependencies();
    const result = await new AdminOperationsService(deps.db, deps.auth).repairCustomerEmail({
      actor: { uid: "admin-uid", email: "admin@example.com" },
      uid: "player-uid",
      email: " Jonathan.Bariller@gmail.com ",
      reason: "Player confirmed the selected Google account.",
      now: new Date("2026-08-26T12:00:00.000Z")
    });

    expect(deps.getUserByEmail).toHaveBeenCalledWith("jonathan.bariller@gmail.com");
    expect(deps.updateUser).toHaveBeenCalledWith("player-uid", {
      email: "jonathan.bariller@gmail.com",
      emailVerified: false
    });
    expect(deps.revokeRefreshTokens).toHaveBeenCalledWith("player-uid");
    expect(deps.create).toHaveBeenCalledWith(expect.objectContaining({
      action: "identity.email.repair",
      targetId: "player-uid",
      metadata: expect.objectContaining({ email: "jonathan.bariller@gmail.com", sessionsRevoked: true })
    }));
    expect(result).toMatchObject({ sessionsRevoked: true, requiresFreshProviderSignIn: true });
  });

  it("refuses to overwrite an existing different account email", async () => {
    const deps = dependencies();
    vi.mocked(deps.auth.getUser).mockResolvedValueOnce(googleUser({ email: "different@example.com" }));
    await expect(new AdminOperationsService(deps.db, deps.auth).repairCustomerEmail({
      actor: { uid: "admin-uid", email: "admin@example.com" },
      uid: "player-uid",
      email: "jonathan.bariller@gmail.com",
      reason: "Player confirmed the selected Google account.",
      now: new Date("2026-08-26T12:00:00.000Z")
    })).rejects.toThrow("already has a different email address");
    expect(deps.updateUser).not.toHaveBeenCalled();
  });
});
