import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import type { Auth, DecodedIdToken } from "firebase-admin/auth";
import { ReviewerAccounts } from "../src/admin/reviewer-accounts.js";
import { EntitlementStore } from "../src/infrastructure/entitlement-store.js";

import { resetEnvironmentForTests } from "../src/config/env.js";
beforeEach(() => {
  vi.stubEnv("PROVIDER_TOKEN_ENCRYPTION_KEYS", JSON.stringify({current:"test",keys:{test:Buffer.alloc(32, 7).toString("base64")}}));
  resetEnvironmentForTests();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); resetEnvironmentForTests(); });

const now = new Date("2026-09-21T12:00:00Z");
function fixture() {
  const data = new Map<string, Record<string, any>>();
  function ref(path: string): any {
    return { path, collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
      update: async (value: any) => data.set(path, { ...data.get(path), ...value }),
      set: async (value: any) => data.set(path, value),
      create: async (value: any) => data.set(path, value),
      get: async () => ({ exists: data.has(path), data: () => data.get(path) }) };
  }
  const tx = { get: (r: any) => r.get(), create: (r: any, value: any) => data.set(r.path, value),
    update: (r: any, value: any) => data.set(r.path, { ...data.get(r.path), ...value }) };
  const db = { collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: vi.fn(async (fn: any) => fn(tx)) };
  const auth = { createUser: vi.fn(async (_value: any) => ({})), updateUser: vi.fn(async () => ({})),
    getUser: vi.fn(async () => ({ email: "private@example.com", disabled: false })),
    generateSignInWithEmailLink: vi.fn(async () => "https://wonderlang-accounts.firebaseapp.com/__/auth/links?secret=private") };
  const service = new ReviewerAccounts(db as unknown as Firestore, auth as unknown as Auth);
  const token = { uid: "store-reviewer-google", auth_time: now.getTime() / 1000,
    firebase: { sign_in_provider: "password" } } as DecodedIdToken;
  return { data, db, auth, service, token };
}
describe("reviewer login monitoring", () => {
  it("creates a disabled non-admin account, grants Premium, and enables it without persisting its plaintext password", async () => {
    const f = fixture();
    const grant = vi.spyOn(EntitlementStore.prototype, "upsertGrant").mockResolvedValue(true);
    const result = await f.service.create("apple", { uid: "owner", email: "owner@example.com" }, now);
    expect(f.auth.createUser).toHaveBeenCalledWith(expect.objectContaining({ uid: "store-reviewer-apple", disabled: true, emailVerified: false }));
    expect(grant).toHaveBeenCalledWith(expect.objectContaining({ uid: "store-reviewer-apple", product: "premium_lifetime_pass", state: "active", provider: "admin" }), expect.anything());
    expect(f.auth.updateUser).toHaveBeenCalledWith("store-reviewer-apple", { disabled: false });
    expect(result.password.length).toBeGreaterThanOrEqual(32);
    expect(JSON.stringify([...f.data.values()])).not.toContain(result.password);
    expect(JSON.stringify([...f.data.values()])).not.toContain('"admin":true');
  });
  it("never overwrites an existing account or resets its password on retries", async () => {
    const f = fixture();
    f.auth.createUser.mockRejectedValue({ code: "auth/uid-already-exists" });
    await expect(f.service.create("google", { uid: "owner", email: "owner@example.com" }, now)).rejects.toThrow("already exists");
    expect(f.auth.updateUser).not.toHaveBeenCalled();
    expect(f.data.size).toBe(0);
  });
  it("keeps a partially provisioned account disabled if its grant fails", async () => {
    const f = fixture();
    vi.spyOn(EntitlementStore.prototype, "upsertGrant").mockRejectedValue(new Error("offline"));
    await expect(f.service.create("apple", { uid: "owner", email: "owner@example.com" }, now)).rejects.toThrow("offline");
    expect(f.auth.updateUser).not.toHaveBeenCalled();
  });
  it("counts a verified session once despite repeated API calls and token refreshes", async () => {
    const f = fixture();
    f.data.set("reviewerAccounts/store-reviewer-google", { totalLogins: 0 });
    await f.service.recordLogin(f.token, now);
    await f.service.recordLogin({ ...f.token, iat: f.token.auth_time + 60 }, now);
    expect(f.data.get("reviewerAccounts/store-reviewer-google")?.totalLogins).toBe(1);
    await f.service.recordLogin({ ...f.token, auth_time: f.token.auth_time + 2 }, now);
    expect(f.data.get("reviewerAccounts/store-reviewer-google")?.totalLogins).toBe(2);
  });
  it("ignores ordinary users, missing registrations, and desktop custom-token handoffs", async () => {
    const f = fixture();
    await f.service.recordLogin({ ...f.token, uid: "customer" }, now);
    expect(f.db.runTransaction).not.toHaveBeenCalled();
    await f.service.recordLogin(f.token, now);
    expect(f.data.size).toBe(0);
    f.data.set("reviewerAccounts/store-reviewer-google", { totalLogins: 0 });
    await f.service.recordLogin({ ...f.token, firebase: { identities: {}, sign_in_provider: "custom" } }, now);
    expect(f.data.get("reviewerAccounts/store-reviewer-google")?.totalLogins).toBe(0);
  });
  it("does not move the latest login backwards when an older session calls the API", async () => {
    const f = fixture();
    f.data.set("reviewerAccounts/store-reviewer-google", { totalLogins: 1, lastLoginAt: now.toISOString() });
    await f.service.recordLogin({ ...f.token, auth_time: f.token.auth_time - 20 }, now);
    expect(f.data.get("reviewerAccounts/store-reviewer-google")?.lastLoginAt).toBe(now.toISOString());
  });
  it("only issues mobile links for registered reviewer accounts with fresh authentication", async () => {
    const f = fixture();
    await expect(f.service.mobileLink(f.token, now)).rejects.toThrow("dedicated review");
    f.data.set("reviewerAccounts/store-reviewer-google", {});
    await expect(f.service.mobileLink({ ...f.token, auth_time: f.token.auth_time - 601 }, now)).rejects.toThrow("sign in again");
    expect(f.auth.generateSignInWithEmailLink).not.toHaveBeenCalled();
    await f.service.mobileLink(f.token, now);
    expect(f.auth.generateSignInWithEmailLink).toHaveBeenCalledWith("private@example.com", expect.objectContaining({ handleCodeInApp: true, android: { packageName: "com.wonderlang.app", installApp: false } }));
  });
  it("does not issue links for disabled reviewers", async () => {
    const f = fixture();
    f.data.set("reviewerAccounts/store-reviewer-google", {});
    f.auth.getUser.mockResolvedValue({ email: "private@example.com", disabled: true });
    await expect(f.service.mobileLink(f.token, now)).rejects.toThrow("unavailable");
    expect(f.auth.generateSignInWithEmailLink).not.toHaveBeenCalled();
  });
});

it("saves encrypted existing credentials and retrieves them without changing Firebase passwords or exposing them in audit entries", async () => {
  const f = fixture();
  f.data.set("reviewerAccounts/store-reviewer-google", {totalLogins: 3});
  const actor = {uid:"owner",email:"owner@example.com"};
  await f.service.saveCredentials("google", "test-only-strong-password!", actor, now);
  expect(JSON.stringify([...f.data.values()])).not.toContain("test-only-strong-password!");
  expect(f.auth.updateUser).not.toHaveBeenCalled();
  expect(f.data.get("reviewerAccounts/store-reviewer-google")?.totalLogins).toBe(3);
  expect((await f.service.credentials("google", actor, now)).password).toBe("test-only-strong-password!");
  const encrypted = f.data.get("reviewerAccounts/store-reviewer-google")?.encryptedPassword;
  f.data.set("reviewerAccounts/store-reviewer-apple", { encryptedPassword: encrypted });
  await expect(f.service.credentials("apple", actor, now)).rejects.toThrow("authentication failed");
});
it("does not store credentials for a missing reviewer", async () => {
  const f = fixture();
  await expect(f.service.saveCredentials("apple", "test-only-password!", {uid:"owner",email:"owner@example.com"}, now)).rejects.toThrow("does not exist");
  expect(f.data.size).toBe(0);
});
