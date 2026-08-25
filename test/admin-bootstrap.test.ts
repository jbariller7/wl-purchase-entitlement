import { describe, expect, it, vi } from "vitest";
import type { DecodedIdToken, Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { AdminBootstrapService, adminBootstrapConfirmation } from "../src/admin/bootstrap-service.js";

const now = new Date("2026-08-25T10:00:00.000Z");
const email = "wonderlang.thegame@gmail.com";

function actor(overrides: Partial<DecodedIdToken> = {}): DecodedIdToken {
  return {
    uid: "owner-uid",
    aud: "wonderlang-accounts",
    auth_time: Math.floor(now.getTime() / 1000) - 30,
    exp: Math.floor(now.getTime() / 1000) + 3600,
    firebase: { identities: {}, sign_in_provider: "google.com" },
    iat: Math.floor(now.getTime() / 1000) - 30,
    iss: "https://securetoken.google.com/wonderlang-accounts",
    sub: "owner-uid",
    email,
    email_verified: true,
    ...overrides
  } as DecodedIdToken;
}

function dependencies(customClaims: Record<string, unknown> = {}) {
  const auditUpdates: Array<Record<string, unknown>> = [];
  const add = vi.fn(async () => ({ update: async (value: Record<string, unknown>) => { auditUpdates.push(value); } }));
  const getUser = vi.fn(async () => ({
    uid: "owner-uid",
    email,
    emailVerified: true,
    customClaims
  }));
  const setCustomUserClaims = vi.fn(async () => undefined);
  const revokeRefreshTokens = vi.fn(async () => undefined);
  const auth = { getUser, setCustomUserClaims, revokeRefreshTokens } as unknown as Auth;
  const db = { collection: () => ({ add }) } as unknown as Firestore;
  return { auth, db, add, auditUpdates, getUser, setCustomUserClaims, revokeRefreshTokens };
}

describe("initial administrator bootstrap", () => {
  it("requires the configured verified Google account, recent auth, and exact phrase", async () => {
    const deps = dependencies();
    const service = new AdminBootstrapService(deps.auth, deps.db);
    const confirmationPhrase = adminBootstrapConfirmation(email);

    await expect(service.grant({ actor: actor({ email: "other@example.com" }), configuredEmail: email, confirmationPhrase, now }))
      .rejects.toThrow("not the configured");
    await expect(service.grant({ actor: actor({ firebase: { identities: {}, sign_in_provider: "apple.com" } }), configuredEmail: email, confirmationPhrase, now }))
      .rejects.toThrow("configured Google account");
    await expect(service.grant({ actor: actor({ auth_time: Math.floor(now.getTime() / 1000) - 601 }), configuredEmail: email, confirmationPhrase, now }))
      .rejects.toThrow("Sign in with Google again");
    await expect(service.grant({ actor: actor(), configuredEmail: email, confirmationPhrase: "SET ADMIN someone@example.com", now }))
      .rejects.toThrow("Type SET ADMIN");
    expect(deps.getUser).not.toHaveBeenCalled();
  });

  it("grants only the admin claim, audits it, and revokes the bootstrap session", async () => {
    const deps = dependencies({ existing: "preserved" });
    const result = await new AdminBootstrapService(deps.auth, deps.db).grant({
      actor: actor(),
      configuredEmail: email,
      confirmationPhrase: adminBootstrapConfirmation(email),
      now
    });

    expect(result).toEqual({ granted: true, changed: true, signInAgain: true });
    expect(deps.setCustomUserClaims).toHaveBeenCalledWith("owner-uid", { existing: "preserved", admin: true });
    expect(deps.revokeRefreshTokens).toHaveBeenCalledWith("owner-uid");
    expect(deps.add).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin_claim.set",
      state: "started",
      actorUid: "owner-uid",
      targetUid: "owner-uid",
      targetEmail: email,
      signInProvider: "google.com",
      createdAt: now.toISOString()
    }));
    expect(deps.auditUpdates).toEqual([{ state: "completed", completedAt: now.toISOString() }]);
  });

  it("is idempotent when the verified account already has the claim", async () => {
    const deps = dependencies({ admin: true });
    await expect(new AdminBootstrapService(deps.auth, deps.db).grant({
      actor: actor(),
      configuredEmail: email,
      confirmationPhrase: adminBootstrapConfirmation(email),
      now
    })).resolves.toEqual({ granted: true, changed: false, signInAgain: false });
    expect(deps.add).not.toHaveBeenCalled();
    expect(deps.setCustomUserClaims).not.toHaveBeenCalled();
    expect(deps.revokeRefreshTokens).not.toHaveBeenCalled();
  });
});
