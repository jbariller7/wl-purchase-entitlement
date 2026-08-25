import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("customer interface route contract", () => {
  const account = read("integrations/web/account-widget/wonderlang-account.js");
  const accountStyles = read("integrations/web/account-widget/wonderlang-account.css");
  const api = read("netlify/functions/api.ts");

  it("binds every visible customer action and form", () => {
    const controls = [...new Set([...account.matchAll(/data-action="([a-z-]+)"/g)].map((match) => match[1]))].sort();
    const boundControls = [...new Set([...account.matchAll(/querySelector\('\[data-action="([a-z-]+)"\]'\)\.addEventListener/g)].map((match) => match[1]))].sort();
    expect(boundControls).toEqual(controls);

    const forms = [...new Set([...account.matchAll(/data-form="([a-z-]+)"/g)].map((match) => match[1]))].sort();
    const boundForms = [...new Set([...account.matchAll(/querySelector\('\[data-form="([a-z-]+)"\]'\)\.addEventListener/g)].map((match) => match[1]))].sort();
    expect(boundForms).toEqual(forms);
  });

  it("keeps each customer API call paired with a server route", () => {
    const routes = [
      ["/api/v1/config", 'path === "/v1/config"'],
      ["/api/v1/me", 'path === "/v1/me"'],
      ["/api/v1/device-sign-in/preview", 'path === "/v1/device-sign-in/preview"'],
      ["/api/v1/device-sign-in/approve", 'path === "/v1/device-sign-in/approve"'],
      ["/api/v1/checkout", 'path === "/v1/checkout"'],
      ["/api/v1/billing-portal", 'path === "/v1/billing-portal"'],
      ["/api/v1/legacy/claim", 'path === "/v1/legacy/claim"'],
      ["/api/v1/me/second-platform-request", 'path === "/v1/me/second-platform-request"'],
      ["/api/v1/me/second-platform-request/cancel", 'path === "/v1/me/second-platform-request/cancel"'],
      ["/api/v1/me/revoke-sessions", 'path === "/v1/me/revoke-sessions"'],
      ["/api/v1/me/deletion-preview", 'path === "/v1/me/deletion-preview"'],
      ["/api/v1/me/deletion-commit", 'path === "/v1/me/deletion-commit"']
    ] as const;
    for (const [clientRoute, serverRoute] of routes) {
      expect(account).toContain(clientRoute);
      expect(api).toContain(serverRoute);
    }
  });

  it("renders honest loading, signed-out, success, failure, permission, and disabled states", () => {
    for (const state of [
      "Loading account…",
      'class="wl-signed-out" hidden',
      'class="wl-signed-in" hidden',
      "this.status(`Signed in as",
      "Signed in with Firebase as",
      "Account data and entitlements will become available after the test backend is configured.",
      '"auth/internal-error"',
      "The sign-in popup is unavailable. Continuing securely in this browser…",
      "this.fail(error)",
      "Verify your WonderLang account email before approving a new device.",
      "button.disabled = true",
      "billingButton.disabled",
      "No login, payment, entitlement, cloud save, or account-security action on this page reaches a live service."
    ]) expect(account + api).toContain(state);
  });

  it("keeps demo and authenticated sections hidden until the controller explicitly reveals them", () => {
    expect(accountStyles).toContain("wonderlang-account [hidden] { display: none !important; }");
    expect(account).toContain('previewParam === "1"');
    expect(account).toContain("this.querySelector('[data-section=\"demo-banner\"]').hidden = false;");
  });

  it("restores usable sign-in controls before handling a failed redirect or email-link result", () => {
    expect(account.indexOf("onAuthStateChanged(this.auth")).toBeGreaterThan(-1);
    expect(account.indexOf("onAuthStateChanged(this.auth")).toBeLessThan(account.indexOf("await this.finishEmailLink()"));
    expect(account).toContain("await getRedirectResult(this.auth);");
    expect(account).toContain("catch (error) { this.fail(error); }");
  });
});

describe("administrator interface route contract", () => {
  const admin = read("integrations/web/admin-console/admin.js");
  const api = read("netlify/functions/admin-api.ts");

  it("binds every rendered administrator control family", () => {
    for (const selector of [
      "[data-view]",
      '[data-action="sign-out"]',
      '[data-action="download-template"]',
      "[data-customer-action]",
      "[data-second-platform-open]",
      "[data-second-platform-decision]",
      "[data-refund]",
      "[data-revoke-grant]",
      "[data-retry-job]",
      "[data-retry-cleanup]",
      "[data-release-event]",
      "[data-provider=\"google\"]",
      "[data-provider=\"apple\"]"
    ]) expect(admin).toContain(selector);
    for (const form of ["#customer-search", "#grant-form", "#price-form", "#import-form"]) expect(admin).toContain(form);
  });

  it("keeps each administrator operation paired with a protected server route", () => {
    const exactRoutes = [
      ["/admin-api/v1/overview", 'path === "/v1/overview"'],
      ["/admin-api/v1/catalog", 'path === "/v1/catalog"'],
      ["/admin-api/v1/catalog/price-preview", 'path === "/v1/catalog/price-preview"'],
      ["/admin-api/v1/catalog/price-commit", 'path === "/v1/catalog/price-commit"'],
      ["/admin-api/v1/refunds/preview", 'path === "/v1/refunds/preview"'],
      ["/admin-api/v1/refunds/commit", 'path === "/v1/refunds/commit"'],
      ["/admin-api/v1/imports/preview", 'path === "/v1/imports/preview"'],
      ["/admin-api/v1/imports/commit", 'path === "/v1/imports/commit"'],
      ["/admin-api/v1/operations", 'path === "/v1/operations"'],
      ["/admin-api/v1/inventory", 'path === "/v1/inventory"'],
      ["/admin-api/v1/audit", 'path === "/v1/audit"'],
      ["/admin-api/v1/second-platform-requests", 'path === "/v1/second-platform-requests"'],
      ["/admin-api/v1/session", 'path === "/v1/session"']
    ] as const;
    for (const [clientRoute, serverRoute] of exactRoutes) {
      expect(admin).toContain(clientRoute);
      expect(api).toContain(serverRoute);
    }
    for (const dynamicRoute of [
      "grantCustomerMatch",
      "accessMatch",
      "sessionsMatch",
      "cancelDeletionMatch",
      "secondPlatformDecisionMatch",
      "revokeGrantMatch",
      "retryMatch",
      "cleanupRetryMatch",
      "releaseMatch"
    ]) expect(api).toContain(dynamicRoute);
  });

  it("renders loading, empty, error, permission, disabled, and success feedback", () => {
    for (const state of [
      'class="loading"',
      'class="empty-state"',
      'class="error-state"',
      "This account is not an administrator.",
      "DEPLOYMENT GUARDS",
      "state.notice",
      "toast(notice.message, notice.error)",
      "SIMULATED DEMO — NOT LIVE DATA"
    ]) expect(admin).toContain(state);
    expect(api).toContain("requireAdmin(");
  });
});
