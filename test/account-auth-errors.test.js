import { describe, expect, it } from "vitest";
import { friendlyAccountError } from "../integrations/web/account-widget/auth-errors.js";

describe("customer authentication recovery messages", () => {
  it.each([
    ["auth/network-request-failed", "Check your connection"],
    ["auth/operation-not-allowed", "not configured yet"],
    ["auth/unauthorized-domain", "not authorized yet"],
    ["auth/popup-closed-by-user", "was canceled"],
    ["auth/user-disabled", "account is disabled"],
    ["auth/invalid-action-code", "invalid or has already been used"],
    ["auth/expired-action-code", "has expired"],
    ["auth/too-many-requests", "Wait a few minutes"],
    ["auth/provider-already-linked", "already linked to your WonderLang account"],
    ["auth/credential-already-in-use", "never merges accounts automatically"],
    ["auth/account-exists-with-different-credential", "explicitly link this one"],
    ["auth/web-storage-unsupported", "blocks the secure storage"],
    ["auth/internal-error", "could not start in this browser"]
  ])("maps %s to actionable guidance", (code, expected) => {
    expect(friendlyAccountError({ code, message: "Firebase: Error (secret provider detail)." })).toContain(expected);
  });

  it("preserves a safe server message while stripping control characters", () => {
    expect(friendlyAccountError({ message: "Account request failed.\u0000\nTry again." }))
      .toBe("Account request failed. Try again.");
  });

  it("does not expose an unmapped raw Firebase error", () => {
    expect(friendlyAccountError({ code: "auth/new-provider-error", message: "Firebase: Error (auth/new-provider-error)." }))
      .toBe("Something went wrong. Please try again or contact WonderLang support.");
  });
});
