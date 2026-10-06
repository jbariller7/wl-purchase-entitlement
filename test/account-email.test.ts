import { describe, expect, it, vi } from "vitest";
import type { Auth, DecodedIdToken, UserRecord } from "firebase-admin/auth";
import { accountEmails, authoritativeGoogleEmail, resolveAccountIdentity, restoreAccountEmail } from "../src/identity/account-email.js";

const record = (email = "buyer@gmail.com", overrides = {}) => ({ uid: "u", disabled: false, emailVerified: false, providerData: [{ providerId: "google.com", uid: "google-subject", email }], ...overrides }) as UserRecord;
const token = (overrides = {}) => ({ uid: "u", firebase: { sign_in_provider: "google.com" }, ...overrides }) as DecodedIdToken;
describe("separate-provider account email", () => {
  it("recovers the Gmail identity for an authenticated account without modifying credentials", async () => {
    const getUser = vi.fn().mockResolvedValue(record());
    const updateUser = vi.fn();
    const result = await resolveAccountIdentity(token(), { getUser, updateUser } as unknown as Auth);
    expect(result).toMatchObject({ uid: "u", email: "buyer@gmail.com", email_verified: true });
    expect(getUser).toHaveBeenCalledWith("u");
    expect(updateUser).not.toHaveBeenCalled();
  });
  it("supports the same account through the desktop custom-token handoff", async () => {
    const identity = token({ firebase: { sign_in_provider: "custom" } });
    expect(await resolveAccountIdentity(identity, { getUser: async () => record() } as unknown as Auth)).toMatchObject({email: "buyer@gmail.com", email_verified: true});
  });
  it("does not trust third-party email domains, conflicting identities, disabled accounts or other providers", async () => {
    for (const user of [record("buyer@example.com"), record("buyer@gmail.com.evil.test"), record("buyer@gmail.com", {email: "someone@gmail.com"}), record("buyer@gmail.com", {disabled: true}), record("buyer@gmail.com", {providerData:[{providerId:"facebook.com", uid:"sub", email:"buyer@gmail.com"}]}), record("buyer@gmail.com", {providerData:[{providerId:"google.com", email:"buyer@gmail.com"}]})]) {
      expect(authoritativeGoogleEmail(user)).toBeNull();
      const original = token();
      expect(await resolveAccountIdentity(original, {getUser:async()=>user} as unknown as Auth)).toBe(original);
    }
  });
  it("never changes a verified token or elevates an unverified email/password sign-in", async () => {
    for (const identity of [token({email:"verified@example.com",email_verified:true}),token({firebase:{sign_in_provider:"password"},email:"buyer@gmail.com",email_verified:false})]) {
      const getUser=vi.fn();
      expect(await resolveAccountIdentity(identity,{getUser} as unknown as Auth)).toBe(identity);
      expect(getUser).not.toHaveBeenCalled();
    }
  });
  it("refuses a mismatched UID and propagates identity-service outages", async () => {
    const identity=token();
    expect(await resolveAccountIdentity(identity,{getUser:async()=>record("buyer@gmail.com",{uid:"other"})} as unknown as Auth)).toBe(identity);
    await expect(resolveAccountIdentity(identity,{getUser:async()=>{throw new Error("offline");}} as unknown as Auth)).rejects.toThrow("offline");
  });
  it("persists a proven Gmail email only for explicit recovery; never merges conflicting accounts", async () => {
    const user=record();
    const updateUser=vi.fn().mockResolvedValue({...user,email:"buyer@gmail.com",emailVerified:true});
    await restoreAccountEmail({updateUser} as unknown as Auth,user);
    expect(updateUser).toHaveBeenCalledWith("u",{email:"buyer@gmail.com",emailVerified:true});
    updateUser.mockRejectedValue({code:"auth/email-already-exists"});
    expect(await restoreAccountEmail({updateUser} as unknown as Auth,user)).toBe(user);
  });
  it("uses provider email for display without claiming arbitrary provider email is verified", () => {
    expect(accountEmails(record(" Provider@Example.com "))).toEqual(["provider@example.com"]);
    expect(authoritativeGoogleEmail(record("Provider@Example.com"))).toBeNull();
  });
});
