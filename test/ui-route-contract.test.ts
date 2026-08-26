import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("customer interface route contract", () => {
  const account = read("integrations/web/account-widget/wonderlang-account.js");
  const accountStyles = read("integrations/web/account-widget/wonderlang-account.css");
  const api = read("netlify/functions/api.ts");
  const stripeEvents = read("src/providers/stripe/event-processor.ts");

  it("binds every visible customer action and form", () => {
    const controls = [...new Set([...account.matchAll(/data-action="([a-z-]+)"/g)].map((match) => match[1]))].sort();
    const boundControls = [...new Set([...account.matchAll(/querySelector\('\[data-action="([a-z-]+)"\]'\)\.addEventListener/g)].map((match) => match[1]))].sort();
    expect(boundControls).toEqual(controls);

    const forms = [...new Set([...account.matchAll(/data-form="([a-z-]+)"/g)].map((match) => match[1]))].sort();
    const boundForms = [...new Set([...account.matchAll(/querySelector\('\[data-form="([a-z-]+)"\]'\)\.addEventListener/g)].map((match) => match[1]))].sort();
    expect(boundForms).toEqual(forms);
  });

  it("supports automatic desktop Google handoff without a player-entered code", () => {
    expect(account).toContain('fragment.get("desktop_sign_in")');
    expect(account).toContain("completeDesktopHandoff");
    expect(account).toContain("approvalSecret: this.desktopHandoff.approvalSecret");
    expect(account).toContain("setTimeout(() => window.close(), 350)");
    expect(account).toContain('provider.addScope("email")');
    expect(account).toContain('provider.addScope("profile")');
  });

  it("keeps each customer API call paired with a server route", () => {
    const routes = [
      ["/api/v1/config", 'path === "/v1/config"'],
      ["/api/v1/me", 'path === "/v1/me"'],
      ["/api/v1/device-sign-in/preview", 'path === "/v1/device-sign-in/preview"'],
      ["/api/v1/device-sign-in/approve", 'path === "/v1/device-sign-in/approve"'],
      ["/api/v1/admin-bootstrap", 'path === "/v1/admin-bootstrap"'],
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
      "For security, sign out and sign in again before approving this device.",
      "button.disabled = true",
      "billingButton.disabled",
      "No login, payment, entitlement, cloud save, or account-security action on this page reaches a live service."
    ]) expect(account + api).toContain(state);
  });

  it("authorizes desktop handoff from the authenticated Firebase UID without an email gate", () => {
    const approvalRoute = api.slice(
      api.indexOf('path === "/v1/device-sign-in/approve"'),
      api.indexOf('throw new HttpError(405, "Method Not Allowed")', api.indexOf('path === "/v1/device-sign-in/approve"'))
    );
    expect(approvalRoute).toContain("uid: user.uid");
    expect(approvalRoute).toContain("approvalSecret: approvalInput.data.approvalSecret");
    expect(approvalRoute).toContain("user.auth_time");
    expect(approvalRoute).not.toContain("email_verified");
    expect(approvalRoute).not.toContain("user.email");
  });

  it("keeps demo and authenticated sections hidden until the controller explicitly reveals them", () => {
    expect(accountStyles).toContain("wonderlang-account [hidden] { display: none !important; }");
    expect(account).toContain('previewParam === "1"');
    expect(account).toMatch(/const demoConfig = \{\s*accountApiReady: true,/);
    expect(account).toContain("this.querySelector('[data-section=\"demo-banner\"]').hidden = false;");
    expect(account).toContain("if (!this.deviceCode)");
  });

  it("restores usable sign-in controls before handling a failed redirect or email-link result", () => {
    expect(account.indexOf("onAuthStateChanged(this.auth")).toBeGreaterThan(-1);
    expect(account.indexOf("onAuthStateChanged(this.auth")).toBeLessThan(account.indexOf("await this.finishEmailLink()"));
    expect(account).toContain("await getRedirectResult(this.auth);");
    expect(account).toContain("catch (error) { this.fail(error); }");
  });

  it("refreshes a rejected Firebase session once without weakening server verification", () => {
    expect(account).toContain("attempt.response.status === 401");
    expect(account).toContain("await send(true)");
    expect(account).toContain("user.getIdToken(forceRefresh)");
    expect(account.match(/await send\(true\)/g)).toHaveLength(1);
  });

  it("offers only Premium through website Stripe checkout while retaining native and historical support", () => {
    expect(account).toContain("Available inside WonderLang for Android and iOS through that device's app store.");
    expect(account).not.toContain('data-action="monthly"');
    expect(account).not.toContain('data-action="polyglot"');
    expect(account).not.toContain('["monthly", "polyglot", "premium"');
    expect(account).not.toContain('checkout("mobile_full_monthly"');
    expect(account).not.toContain('checkout("mobile_polyglot_permanent"');
    expect(account).toContain('product: "premium_lifetime_pass"');
    expect(stripeEvents).toContain('metadata.wl_product === "mobile_full_monthly"');
    expect(stripeEvents).toContain('metadata.wl_product === "mobile_polyglot_permanent"');
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
      "[data-download-profile]",
      "[data-release-event]",
      "[data-run-stripe-diagnostic]",
      "[data-run-google-play-diagnostic]",
      "[data-run-firebase-auth-diagnostic]",
      "[data-run-apple-catalog-diagnostic]",
      "[data-provider=\"google\"]",
      "[data-provider=\"apple\"]"
    ]) expect(admin).toContain(selector);
    for (const form of ["#customer-search", "#email-repair-form", "#grant-form", "#price-form", "#import-form"]) expect(admin).toContain(form);
  });

  it("routes audited cloud-save downloads through the authenticated admin API client", () => {
    expect(admin).toContain('const result = await api(`/admin-api/v1/customers/${encodeURIComponent(state.customer.user.uid)}/cloud-save-profiles/');
    expect(admin).not.toContain("const result = await request(`/admin-api/v1/customers/");
    expect(admin).toContain('if (method === "GET" && path.includes("customers")) return demoCustomer;');
    expect(admin).not.toContain('if (path.includes("customers")) return demoCustomer;');
    expect(admin).toContain("if (demo && result.demoPayload)");
    expect(admin).toContain('new Blob([JSON.stringify(result.demoPayload)], { type: "application/json" })');
    expect(admin).not.toContain("downloadUrl: `data:");
  });

  it("renders a sanitized retained cloud-save revision timeline", () => {
    expect(admin).toContain('class="revision-history"');
    expect(admin).toContain('"Revision history"');
    expect(admin).toContain("Each profile is one atomic bundle containing global.rmmzsave and every save slot.");
    expect(admin).not.toContain("LEGACY CLOUD SAVES");
    expect(api).toContain("operations.customerDetail");
  });

  it("keeps each administrator operation paired with a protected server route", () => {
    const exactRoutes = [
      ["/admin-api/v1/overview", 'path === "/v1/overview"'],
      ["/admin-api/v1/catalog", 'path === "/v1/catalog"'],
      ["/admin-api/v1/diagnostics/stripe-catalog", 'path === "/v1/diagnostics/stripe-catalog"'],
      ["/admin-api/v1/diagnostics/google-play-catalog", 'path === "/v1/diagnostics/google-play-catalog"'],
      ["/admin-api/v1/diagnostics/firebase-authentication", 'path === "/v1/diagnostics/firebase-authentication"'],
      ["/admin-api/v1/diagnostics/apple-catalog", 'path === "/v1/diagnostics/apple-catalog"'],
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
      "repairEmailMatch",
      "sessionsMatch",
      "cancelDeletionMatch",
      "secondPlatformDecisionMatch",
      "revokeGrantMatch",
      "retryMatch",
      "cleanupRetryMatch",
      "cloudProfileDownloadMatch",
      "cloudProfileRestoreMatch",
      "releaseMatch"
    ]) expect(api).toContain(dynamicRoute);
  });

  it("repairs missing federated emails through an audited admin-only workflow", () => {
    expect(admin).toContain("Restore a missing provider email");
    expect(admin).toContain("/repair-email");
    expect(api).toContain("repairEmailSchema");
    expect(api).toContain("operations.repairCustomerEmail");
    expect(read("src/admin/operations-service.ts")).toContain('action: "identity.email.repair"');
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

  it("limits the working Stripe price editor to Premium and labels mobile prices as native", () => {
    expect(admin).toContain('<input type="hidden" name="kind" value="premium">');
    expect(admin).not.toContain('<option value="monthly">Mobile Monthly</option>');
    expect(admin).not.toContain('<option value="polyglot">Polyglot Permanent Access</option>');
    expect(admin).toContain("Managed in Google Play / App Store Connect");
    expect(api).toContain('kind: z.literal("premium")');
  });

  it("offers only current products for new manual grants while keeping historical chapters import-only", () => {
    expect(admin).toContain('<option value="mobile_polyglot_permanent">Polyglot Permanent Access</option>');
    expect(admin).toContain('<option value="premium_lifetime_pass">Premium Lifetime Pass</option>');
    expect(admin).not.toContain('<option value="legacy_chapter_1">');
    expect(admin).not.toContain('<option value="legacy_mobile_full">');
    expect(admin).toContain("Historical chapter purchases completed by");
  });

  it("keeps safe-demo effective access synchronized with grant creation, revocation, and Premium requests", () => {
    expect(admin).toContain("function syncDemoCustomerEntitlements()");
    expect(admin.match(/syncDemoCustomerEntitlements\(\);/g)).toHaveLength(3);
    expect(admin).toContain("demoCustomer.effectiveProducts = [...new Set(active.map((grant) => grant.product))]");
    expect(admin).toContain('accessKind: premiumLifetime ? "premium_lifetime" : permanent ? "permanent" : subscription ? "subscription" : "none"');
  });

  it("provides a safe recovery-state profile for testing account-deletion cancellation", () => {
    expect(admin).toContain('demoProfile === "deletion"');
    expect(admin).toContain('state: "scheduled"');
    expect(admin).toContain('data-customer-action="cancel-deletion"');
  });
});
