import { describe, expect, it } from "vitest";
import {
  formatLoginProviders,
  friendlyLoginProvider
} from "../integrations/web/account-widget/provider-labels.js";

describe("customer login provider labels", () => {
  it.each([
    ["google.com", "Google"],
    ["apple.com", "Apple"],
    ["password", "Email"],
    ["passwordless-email", "Email"],
    ["custom-provider", "Other sign-in"]
  ])("maps %s to %s", (providerId, label) => {
    expect(friendlyLoginProvider(providerId)).toBe(label);
  });

  it("deduplicates equivalent provider identifiers and never exposes Firebase's password label", () => {
    expect(formatLoginProviders(["google.com", "google", "password", "passwordless-email"]))
      .toBe("Google, Email");
  });

  it("uses an understandable fallback when Firebase returns no provider data", () => {
    expect(formatLoginProviders([])).toBe("Email link");
  });
});
