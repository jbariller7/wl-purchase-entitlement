import type { DecodedIdToken } from "firebase-admin/auth";
import { describe, expect, it } from "vitest";
import { requireVerifiedDeviceApprovalIdentity } from "../src/http/auth.js";

function identity(overrides: Partial<DecodedIdToken> = {}): DecodedIdToken {
  return {
    aud: "wonderlang-accounts",
    auth_time: 1,
    exp: 2,
    firebase: { identities: {}, sign_in_provider: "password" },
    iat: 1,
    iss: "https://securetoken.google.com/wonderlang-accounts",
    sub: "player-1",
    uid: "player-1",
    ...overrides
  };
}

describe("desktop device approval identity", () => {
  it("accepts a Google-authenticated account when Firebase omits email_verified", () => {
    expect(requireVerifiedDeviceApprovalIdentity(identity({
      email: " Jonathan.Bariller@gmail.com ",
      firebase: { identities: {}, sign_in_provider: "google.com" }
    }))).toBe("jonathan.bariller@gmail.com");
  });

  it("accepts an Apple-authenticated account when email_verified is false", () => {
    expect(requireVerifiedDeviceApprovalIdentity(identity({
      email: "player@privaterelay.appleid.com",
      email_verified: false,
      firebase: { identities: {}, sign_in_provider: "apple.com" }
    }))).toBe("player@privaterelay.appleid.com");
  });

  it("continues to require verification for email/password accounts", () => {
    expect(() => requireVerifiedDeviceApprovalIdentity(identity({
      email: "player@example.com",
      email_verified: false
    }))).toThrow("Verify your WonderLang account email before approving a new device.");
  });

  it("accepts a verified email identity and rejects identities without email", () => {
    expect(requireVerifiedDeviceApprovalIdentity(identity({
      email: "player@example.com",
      email_verified: true
    }))).toBe("player@example.com");
    expect(() => requireVerifiedDeviceApprovalIdentity(identity({
      firebase: { identities: {}, sign_in_provider: "google.com" }
    }))).toThrow("Verify your WonderLang account email before approving a new device.");
  });
});
