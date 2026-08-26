import { initializeApp } from "firebase/app";
import { getToken as getAppCheckToken, initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import {
  getAuth, getRedirectResult, GoogleAuthProvider, OAuthProvider, onAuthStateChanged,
  signInWithPopup, signInWithRedirect, signOut
} from "firebase/auth";
import "./admin.css";

const appNode = document.querySelector("#app");
const previewHosts = new Set(["localhost", "127.0.0.1", "wl-purchase-entitlement.netlify.app"]);
let demo = previewHosts.has(location.hostname) && new URLSearchParams(location.search).get("demo") === "1";
const demoProfile = new URLSearchParams(location.search).get("profile");
const state = { auth: null, appCheck: null, user: demo ? { email: "owner@wonderlang.net" } : null, config: { environment: demo ? "test" : "unknown", checkoutEnabled: false }, view: "overview", customer: null, secondPlatformRequests: [], stripeDiagnostic: null, googlePlayDiagnostic: null, firebaseAuthDiagnostic: null, appleCatalogDiagnostic: null, previews: {}, notice: null };

const demoOverview = {
  metrics: { activeSubscriptions: 184, permanentCustomers: 271, premiumCustomers: 56, lifetimeCustomers: 327, graceSubscriptions: 6, pendingSecondPlatformRequests: 1, failedOperations: 3, cloudStorageBytes: 18427904, cloudStorageDailyChangeBytes: 524288 },
  alerts: [
    { view: "operations", tone: "danger", title: "2 delivery jobs need attention", detail: "Retries are paused in this test deployment", action: "Open operations" },
    { view: "customers", tone: "neutral", title: "1 Premium second-platform request awaiting review", detail: "Approve or decline it with an audit reason", action: "Review request" },
    { view: "inventory", tone: "warning", title: "Japanese Steam inventory is low", detail: "8 keys available · threshold 10", action: "Review inventory" },
    { view: "customers", tone: "neutral", title: "6 subscriptions are in payment grace", detail: "Access remains available for up to seven days", action: "View customers" }
  ],
  activity: [
    { time: new Date().toISOString(), customer: "amina@example.com", event: "mobile_full_monthly", amount: null, state: "active" },
    { time: new Date(Date.now() - 900000).toISOString(), customer: "theo@example.com", event: "premium_lifetime_pass", amount: null, state: "active" }
  ]
};
const demoSecondPlatformRequest = {
  uid: "demo_8a2f43",
  email: "amina@example.com",
  state: "pending",
  sourcePlatform: "android",
  requestedPlatform: "ios",
  revision: 1,
  submittedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  approvalLeaseUntil: null,
  decisionAt: null
};
const demoCustomer = {
  user: { uid: "demo_8a2f43", email: "amina@example.com", emailVerified: true, disabled: false, providers: ["google.com", "apple.com"], createdAt: "2026-02-14T10:00:00Z", lastSignInAt: new Date().toISOString() },
  entitlements: { accessKind: "premium_lifetime", cloudSave: true, mobilePlatforms: ["android", "ios"], permanentMobilePlatforms: ["android"], pcMacAccess: true, futureContent: true, premiumLifetime: true, secondMobilePlatformEligible: true, subscriptionState: "active", subscriptionEndsAt: "2026-09-23T00:00:00Z", sourceGrantIds: ["grant_demo", "grant_demo_premium"] },
  effectiveProducts: ["mobile_full_monthly", "premium_lifetime_pass"],
  subscription: { provider: "stripe", phase: "active", providerStatus: "active", startsAt: "2026-08-01T00:00:00Z", renewsAt: "2026-09-23T00:00:00Z", endsAt: null, graceEndsAt: null, trialEndsAt: null, cancelAtPeriodEnd: false },
  grants: [{ id: "grant_demo", provider: "stripe", providerCustomerId: "cus_demo", providerTransactionId: "sub_demo", providerSubscriptionId: "sub_demo", product: "mobile_full_monthly", state: "active", startsAt: "2026-08-01T00:00:00Z" }, { id: "grant_demo_premium", provider: "stripe", providerCustomerId: "cus_demo", providerTransactionId: "pi_demo_premium", product: "premium_lifetime_pass", state: "active", startsAt: "2026-08-20T00:00:00Z", metadata: { primaryMobilePlatform: "android" } }],
  providerIdentities: [{ provider: "stripe", product: "mobile_full_monthly", customerId: "cus_demo", transactionId: "sub_demo", subscriptionId: "sub_demo", state: "active" }],
  legacyDiscount: null, stripeCustomerId: "cus_demo", cloudSaves: [{ id: "save1", slot: "save1", byteLength: 48213, sha256: "0123456789abcdef", updatedAt: new Date().toISOString() }],
  payments: [{ id: "pi_demo", amount: 699, amountReceived: 699, amountRefunded: 0, refundableAmount: 699, currency: "USD", status: "succeeded", createdAt: new Date().toISOString(), refunds: [] }],
  deletionRequest: demoProfile === "deletion" ? {
    state: "scheduled",
    requestedAt: new Date().toISOString(),
    deleteAfter: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  } : null,
  secondMobilePlatformRequest: demoSecondPlatformRequest
};

function syncDemoCustomerEntitlements() {
  const active = demoCustomer.grants.filter((grant) => grant.state === "active" || grant.state === "grace");
  const permanentMobilePlatforms = new Set();
  const mobilePlatforms = new Set();
  let premiumLifetime = false;
  let permanent = false;
  let subscription = false;
  let subscriptionInGrace = false;

  for (const grant of active) {
    const platform = grant.metadata?.mobilePlatform ?? grant.metadata?.primaryMobilePlatform ??
      (grant.provider === "google_play" ? "android" : grant.provider === "apple" ? "ios" : null);
    if (grant.product === "premium_lifetime_pass" || grant.product === "mobile_full_lifetime") {
      premiumLifetime = true;
      if (platform) permanentMobilePlatforms.add(platform);
    } else if (grant.product === "mobile_polyglot_permanent" || grant.product === "legacy_mobile_full") {
      permanent = true;
      if (platform) permanentMobilePlatforms.add(platform);
    } else if (grant.product === "mobile_full_monthly") {
      subscription = true;
      subscriptionInGrace ||= grant.state === "grace";
    }
  }

  permanentMobilePlatforms.forEach((platform) => mobilePlatforms.add(platform));
  if (subscription) {
    mobilePlatforms.add("android");
    mobilePlatforms.add("ios");
  }
  demoCustomer.effectiveProducts = [...new Set(active.map((grant) => grant.product))];
  demoCustomer.entitlements = {
    ...demoCustomer.entitlements,
    accessKind: premiumLifetime ? "premium_lifetime" : permanent ? "permanent" : subscription ? "subscription" : "none",
    cloudSave: premiumLifetime || subscription,
    mobilePlatforms: [...mobilePlatforms].sort(),
    permanentMobilePlatforms: [...permanentMobilePlatforms].sort(),
    pcMacAccess: premiumLifetime,
    futureContent: premiumLifetime,
    premiumLifetime,
    secondMobilePlatformEligible: premiumLifetime,
    subscriptionState: subscription ? (subscriptionInGrace ? "grace" : "active") : "inactive",
    sourceGrantIds: active.map((grant) => grant.id)
  };
}
const demoCatalog = {
  revision: 3,
  monthly: { stripePriceId: "price_test_monthly", unitAmount: 699, currency: "USD", recurring: true },
  polyglot: { stripePriceId: "price_test_polyglot", unitAmount: 3199, currency: "USD", recurring: false },
  premium: { stripePriceId: "price_test_premium", unitAmount: 5999, currency: "USD", recurring: false },
  monthlyPriceHistory: [], polyglotPriceHistory: [], premiumPriceHistory: [],
  regionalPrices: {
    monthly: { USD: "6.99", EUR: "6.49", GBP: "5.99", JPY: "787" },
    polyglot: { USD: "31.99", EUR: "30.99", GBP: "26.80", JPY: "3600" },
    premium: { USD: "59.99", EUR: "59.99", GBP: "50.25", JPY: "6750" }
  },
  notes: { priceChangesAffect: "new_checkouts_only", existingSubscriptions: "keep_their_existing_stripe_price", oldPrices: "retained_for_existing_subscriptions_and_webhook_history" }
};
const demoOperations = {
  providerEvents: [{ id: "evt_demo_failed", provider: "stripe", eventType: "invoice.payment_failed", status: "failed", receivedAt: new Date().toISOString(), lastError: "Demo delivery failure" }],
  outbox: [{ id: "job_demo_failed", kind: "meta_conversion", state: "failed", attemptCount: 6, createdAt: new Date().toISOString(), lastError: "Demo token rejected" }],
  reconciliationRuns: [{ id: "reconcile_demo", state: "complete", startedAt: new Date().toISOString(), attempted: 24, succeeded: 24, failed: 0, providerAccess: "read_only" }],
  providerTokenVault: { encryptedTokens: 12, keys: [{ keyId: "staging-2026-08", tokens: 12 }] },
  deviceSignIn: { pending: 2, approved: 1, issuing: 0, consumed: 18, expired: 3 },
  cloudStorage: { capturedAt: new Date().toISOString(), revisionObjects: 384, revisionBytes: 17825792, stagingObjects: 4, stagingBytes: 602112, staleStagingObjects: 1, staleStagingBytes: 150528, totalObjects: 388, totalBytes: 18427904, dailyChangeBytes: 524288, growthAlert: false, staleUploadAlert: true },
  cloudStorageMonitor: { state: "succeeded", lastSucceededAt: new Date().toISOString(), lastError: null },
  cloudSaveCleanup: {
    pending: 2,
    processing: 0,
    failed: 1,
    monitor: { state: "succeeded", lastRunAt: new Date().toISOString(), scanned: 3, deleted: 1, failed: 1, skipped: 1, lastError: null },
    failures: [{ id: "4acb303f-18d2-4b98-b665-058c332271df", state: "failed", attemptCount: 10, createdAt: new Date(Date.now() - 86_400_000).toISOString(), lastAttemptAt: new Date().toISOString(), lastError: "Cloud Storage revision deletion failed." }]
  }
};
const demoInventory = { summary: [{ sheetTab: "Steam English", available: 42, assigned: 318, lowStockThreshold: 15, lowStock: false }, { sheetTab: "Steam Japanese", available: 8, assigned: 94, lowStockThreshold: 10, lowStock: true }, { sheetTab: "Itch English", available: 27, assigned: 71, lowStockThreshold: 20, lowStock: false }], recentFulfillments: [] };
const demoAudit = { entries: [{ id: "audit_demo", actorEmail: "owner@wonderlang.net", action: "catalog.price.change", targetType: "catalog", targetId: "monthly", summary: "Changed monthly price for new checkouts", createdAt: new Date().toISOString() }] };
const ZERO_DECIMAL_CURRENCIES = new Set(["CLP", "JPY", "KRW", "VND"]);

function minorAmount(currency, majorAmount) {
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  const value = Number(majorAmount);
  return Math.round(value * (ZERO_DECIMAL_CURRENCIES.has(normalizedCurrency) ? 1 : 100));
}

function majorAmount(currency, unitAmount) {
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  const digits = ZERO_DECIMAL_CURRENCIES.has(normalizedCurrency) ? 0 : 2;
  return (Number(unitAmount) / (digits === 0 ? 1 : 100)).toFixed(digits);
}

const views = { overview: "Overview", customers: "Customers", billing: "Billing & prices", imports: "Imports", operations: "Operations", inventory: "Key inventory", audit: "Audit history", settings: "Settings" };
const endpoints = {
  overview: "/admin-api/v1/overview", billing: "/admin-api/v1/catalog", operations: "/admin-api/v1/operations",
  inventory: "/admin-api/v1/inventory", audit: "/admin-api/v1/audit", settings: "/admin-api/v1/session",
  secondPlatformRequests: "/admin-api/v1/second-platform-requests"
};

function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]); }
function initials(email = "WL") { return email.split("@")[0].split(/[._-]/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "WL"; }
function formatMoney(amount, currency = "USD") {
  const normalizedCurrency = String(currency || "USD").toUpperCase();
  const divisor = ZERO_DECIMAL_CURRENCIES.has(normalizedCurrency) ? 1 : 100;
  return new Intl.NumberFormat(undefined, { style: "currency", currency: normalizedCurrency }).format(Number(amount || 0) / divisor);
}
function formatDate(value) { if (!value) return "—"; const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(value); }
function formatBytes(value) { if (value === null || value === undefined || !Number.isFinite(Number(value))) return "Not sampled"; const bytes = Number(value); const sign = bytes < 0 ? "−" : ""; const absolute = Math.abs(bytes); const units = ["B", "KB", "MB", "GB", "TB"]; let index = 0; let scaled = absolute; while (scaled >= 1024 && index < units.length - 1) { scaled /= 1024; index += 1; } return `${sign}${scaled.toFixed(index === 0 ? 0 : scaled >= 10 ? 1 : 2)} ${units[index]}`; }
const TRUSTED_HTML_CELL = Symbol("trusted-html-cell");
function jsonCell(value) { return typeof value === "string" ? value : JSON.stringify(value ?? ""); }
function htmlCell(value) { return { [TRUSTED_HTML_CELL]: String(value) }; }
function navItem(id, number) { return `<button type="button" data-view="${id}" class="nav-item${state.view === id ? " selected" : ""}"><span>${number}</span>${views[id]}</button>`; }
function pageIntro(kicker, title, copy, actions = "") { return `<section class="page-intro"><div><p class="section-kicker">${kicker}</p><h2>${title}</h2><p>${copy}</p></div><div class="hero-actions">${actions}</div></section>`; }
function empty(message) { return `<div class="empty-state">${escapeHtml(message)}</div>`; }

function shell(content) {
  const environment = demo ? "Demo · test" : `${state.config.environment || "unknown"}${state.config.checkoutEnabled ? " · checkout on" : " · safe mode"}`;
  const demoBanner = demo ? `<aside class="demo-banner" role="note"><div><strong>SIMULATED DEMO — NOT LIVE DATA</strong><span>Every customer, payment, key count and operation on this page is fictional. Demo actions never call Firebase, Stripe, Google Play, Apple, Sheets or MailerLite.</span></div><a href="/admin/">Exit demo</a></aside>` : "";
  return `<div class="ops-shell"><aside class="side-nav">
    <div class="brand"><span class="brand-mark">W</span><span><strong>WonderLang</strong><small>Operations</small></span></div>
    <nav aria-label="Operations sections">${Object.keys(views).map((id, index) => navItem(id, String(index + 1).padStart(2, "0"))).join("")}</nav>
    <div class="side-foot"><span class="health-dot"></span><span><strong>${state.config.environment === "production" ? "Production" : "Test isolation"}</strong><small>Server-enforced controls</small></span></div>
  </aside><main class="workspace"><header class="topbar"><button class="mobile-menu" type="button" aria-label="Open navigation">Menu</button>
    <div><p class="eyebrow">CONTROL CENTRE</p><h1>${escapeHtml(views[state.view])}</h1></div>
    <div class="top-actions"><span class="environment"><i></i>${escapeHtml(environment)}</span><button class="user-menu" type="button" data-action="sign-out"><span>${initials(state.user?.email)}</span>${escapeHtml(state.user?.email)}</button></div>
  </header><div class="page-content">${demoBanner}${content}</div></main></div><div id="toast" class="toast" role="status" aria-live="polite"></div>`;
}

function metric(label, value, note, tone) { const display = typeof value === "number" ? value.toLocaleString() : escapeHtml(value); return `<article class="metric-card ${tone}"><p>${label}</p><strong>${display}</strong><span>${note}</span></article>`; }
function renderOverview(data) {
  const m = data.metrics || {};
  return `${pageIntro("TODAY AT A GLANCE", "Your business, in one view.", "Purchases, access, delivery health and anything that needs intervention.", '<button class="button secondary" data-view="customers">Find a customer</button><button class="button primary" data-view="imports">Import customers</button>')}
  <section class="metric-grid">${metric("Active monthly", m.activeSubscriptions, "Full mobile game + cloud", "accent")}${metric("Polyglot permanent", m.permanentCustomers, "One mobile platform", "dark")}${metric("Premium Lifetime", m.premiumCustomers, "PC/Mac, cloud and future content", "dark")}${metric("Payment grace", m.graceSubscriptions, "Seven-day access window", "warning")}${metric("Cloud storage", formatBytes(m.cloudStorageBytes), `${formatBytes(m.cloudStorageDailyChangeBytes)} since prior snapshot`, "dark")}${metric("Needs attention", m.failedOperations, "Manual review queue", "danger")}</section>
  <section class="dashboard-grid"><article class="panel attention-panel"><header><div><p class="section-kicker">ATTENTION QUEUE</p><h3>What needs you</h3></div><button class="text-button" data-view="operations">See all</button></header><div class="alert-list">${(data.alerts || []).length ? data.alerts.map((a) => { const view = ["operations", "inventory", "customers"].includes(a.view) ? a.view : "operations"; return `<button class="alert-row" data-view="${view}"><span class="alert-icon ${escapeHtml(a.tone)}"></span><span><strong>${escapeHtml(a.title)}</strong><small>${escapeHtml(a.detail)}</small></span><b>${escapeHtml(a.action)} →</b></button>`; }).join("") : empty("Nothing needs attention.")}</div></article>
  <article class="panel quick-panel"><header><div><p class="section-kicker">SAFE SHORTCUTS</p><h3>Quick actions</h3></div></header><div class="quick-grid">${[["Customer lookup", "Search access, purchases and saves", "customers"], ["Change a price", "New checkouts only", "billing"], ["Issue a refund", "Find the customer, then preview the payment refund", "customers"], ["Import purchases", "Dry-run before applying", "imports"]].map(([t,d,v]) => `<button class="quick-action" data-view="${v}"><span>↗</span><strong>${t}</strong><small>${d}</small></button>`).join("")}</div></article></section>
  <section class="panel activity-panel"><header><div><p class="section-kicker">LIVE LEDGER</p><h3>Recent entitlement activity</h3></div></header>${table(["When", "Customer", "Event", "Value", "Status"], (data.activity || []).map((r) => [formatDate(r.time), r.customer, r.event, r.amount ? formatMoney(r.amount, r.currency) : "—", htmlCell(`<span class="state-pill">${escapeHtml(r.state)}</span>`)]))}</section>`;
}

function renderCustomers() {
  const c = state.customer;
  const openRequestRows = (state.secondPlatformRequests || []).map((request) => [
    request.email,
    request.requestedPlatform === "ios" ? "iOS" : "Android",
    formatDate(request.submittedAt),
    request.state,
    htmlCell(`<button class="text-button" data-second-platform-open="${escapeHtml(request.uid)}">Open customer</button>`)
  ]);
  const requestQueue = `<section class="panel"><header><div><p class="section-kicker">PREMIUM BENEFIT REQUESTS</p><h3>Other mobile platform</h3></div><span class="state-pill">${openRequestRows.length} open</span></header><p class="panel-copy">Premium Lifetime customers may request permanent access on their other mobile platform. Approval creates one audited, idempotent grant; no payment is taken.</p>${table(["Customer", "Requested", "Submitted", "State", "Action"], openRequestRows)}</section>`;
  const paymentRows = (c?.payments || []).map((p) => [formatDate(p.createdAt), p.id, formatMoney(p.amountReceived || p.amount, p.currency), formatMoney(p.amountRefunded || 0, p.currency), p.status, p.refundableAmount > 0 ? htmlCell(`<button class="text-button" data-refund="${escapeHtml(p.id)}" data-amount="${Number(p.refundableAmount)}" data-currency="${escapeHtml(p.currency)}">Refund</button>`) : "—"]);
  const providerRows = (c?.providerIdentities || []).map((p) => [p.provider, p.product, p.customerId || "—", p.transactionId, p.subscriptionId || "—", p.state]);
  const cloudRows = (c?.cloudSaves || []).map((s) => {
    const slot = s.slot || s.id;
    return [slot, formatDate(s.updatedAt), s.byteLength ?? "—", String(s.sha256 || "").slice(0, 12) || "—", htmlCell(`<button class="text-button" data-download-save="${escapeHtml(slot)}">Download</button>`)];
  });
  const sub = c?.subscription;
  const secondPlatformRequest = c?.secondMobilePlatformRequest;
  const requestActionable = secondPlatformRequest?.state === "pending" || (secondPlatformRequest?.state === "approving" && Date.parse(secondPlatformRequest.approvalLeaseUntil || "") <= Date.now());
  const requestPanel = secondPlatformRequest ? `<section class="alert ${secondPlatformRequest.state === "approved" ? "success" : secondPlatformRequest.state === "declined" || secondPlatformRequest.state === "canceled" ? "warning" : "neutral"}"><div><strong>Premium ${secondPlatformRequest.requestedPlatform === "ios" ? "iOS" : "Android"} request · ${escapeHtml(secondPlatformRequest.state)}</strong><span>Submitted ${formatDate(secondPlatformRequest.submittedAt)} · request revision ${Number(secondPlatformRequest.revision || 0)}. Approval grants permanent access without taking a payment.</span></div>${requestActionable ? `<div class="card-actions"><button class="button primary" data-second-platform-decision="approve" data-request-uid="${escapeHtml(c.user.uid)}">Approve</button><button class="button danger" data-second-platform-decision="decline" data-request-uid="${escapeHtml(c.user.uid)}">Decline</button></div>` : ""}</section>` : "";
  const detail = c ? `${c.deletionRequest?.state === "scheduled" ? `<section class="alert warning"><div><strong>Account deletion scheduled</strong><span>Profile and cloud saves will be purged after ${formatDate(c.deletionRequest.deleteAfter)} unless support cancels during recovery.</span></div><button class="button secondary" data-customer-action="cancel-deletion">Cancel deletion</button></section>` : ""}${requestPanel}<section class="customer-grid"><article class="panel detail-card"><header><div><p class="section-kicker">ACCOUNT</p><h3>${escapeHtml(c.user.email || c.user.uid)}</h3></div><span class="state-pill">${c.user.disabled ? "Disabled" : "Enabled"}</span></header><dl class="definition-grid"><div><dt>Firebase UID</dt><dd>${escapeHtml(c.user.uid)}</dd></div><div><dt>Login providers</dt><dd>${escapeHtml((c.user.providers || []).join(", ") || "None")}</dd></div><div><dt>Email verified</dt><dd>${c.user.emailVerified ? "Yes" : "No"}</dd></div><div><dt>Last sign-in</dt><dd>${formatDate(c.user.lastSignInAt)}</dd></div></dl><div class="card-actions"><button class="button secondary" data-customer-action="sessions">Revoke sessions</button><button class="button danger" data-customer-action="access">${c.user.disabled ? "Enable account" : "Disable account"}</button></div></article>
    <article class="panel detail-card"><header><div><p class="section-kicker">EFFECTIVE ACCESS</p><h3>${escapeHtml(c.entitlements.accessKind || "None")}</h3></div></header><dl class="definition-grid"><div><dt>Products</dt><dd>${escapeHtml((c.effectiveProducts || []).join(", ") || "None")}</dd></div><div><dt>Current mobile platforms</dt><dd>${escapeHtml((c.entitlements.mobilePlatforms || []).join(", ") || "None")}</dd></div><div><dt>Permanent mobile platforms</dt><dd>${escapeHtml((c.entitlements.permanentMobilePlatforms || []).join(", ") || "None")}</dd></div><div><dt>PC / Mac</dt><dd>${c.entitlements.pcMacAccess ? "Included" : "Not included"}</dd></div><div><dt>Future content</dt><dd>${c.entitlements.futureContent ? "Included" : "Not included"}</dd></div><div><dt>Second mobile platform</dt><dd>${c.entitlements.secondMobilePlatformEligible ? ((c.entitlements.permanentMobilePlatforms || []).length > 1 ? "Granted" : "Eligible on request") : "Not included"}</dd></div><div><dt>Subscription</dt><dd>${escapeHtml(sub ? `${sub.phase} · ${sub.provider}` : "None")}</dd></div><div><dt>Renews / ends</dt><dd>${formatDate(sub?.renewsAt || sub?.endsAt || sub?.graceEndsAt)}</dd></div><div><dt>Cloud saves</dt><dd>${c.entitlements.cloudSave ? "Allowed" : "Retained, access inactive"}</dd></div></dl></article></section>
    <section class="split-grid"><article class="panel form-panel"><header><div><p class="section-kicker">MANUAL ACCESS</p><h3>Grant an entitlement</h3></div></header><form id="grant-form" class="stack-form"><label>Product<select name="product"><option value="mobile_polyglot_permanent">Polyglot Permanent Access</option><option value="premium_lifetime_pass">Premium Lifetime Pass</option></select></label><label>Mobile platform<select name="mobilePlatform"><option value="android">Android</option><option value="ios">iOS</option></select></label><label>Optional expiry<input type="datetime-local" name="endsAt"></label><label>Audit reason<textarea name="reason" minlength="10" required placeholder="Why is this grant authorized?"></textarea></label><button class="button primary">Grant access</button></form></article>
    <article class="panel"><header><div><p class="section-kicker">GRANTS</p><h3>Access ledger</h3></div></header>${table(["Product", "Source", "State", "Started", "Action"], (c.grants || []).map((g) => [g.product, g.provider, g.state, formatDate(g.startsAt), g.provider === "admin" && g.state === "active" && !g.metadata?.migration ? htmlCell(`<button class="text-button" data-revoke-grant="${escapeHtml(g.id)}">Revoke</button>`) : "—"]))}</article></section>
    <section class="panel"><header><div><p class="section-kicker">PROVIDER IDENTITIES</p><h3>Verified purchase links</h3></div></header>${table(["Provider", "Product", "Customer", "Transaction", "Subscription", "State"], providerRows)}</section>
    <section class="panel spaced"><header><div><p class="section-kicker">STRIPE PAYMENTS</p><h3>Payments and refunds</h3></div></header>${table(["Created", "Payment", "Received", "Refunded", "Status", "Action"], paymentRows)}</section>
    <section class="panel spaced"><header><div><p class="section-kicker">CLOUD SAVES</p><h3>Retained save inventory</h3></div></header><p class="panel-copy">Downloads require a support reason, produce a five-minute private link, and are recorded in Admin Audit.</p>${table(["Slot", "Updated", "Bytes", "SHA-256", "Action"], cloudRows)}</section>` : empty("Search an exact email, Firebase UID, Stripe ID, or provider transaction to inspect an account.");
  return `${pageIntro("CUSTOMER SUPPORT", "Find the whole customer story.", "Access, purchases, login providers, cloud saves and manual actions are tied to one Firebase UID.")}
  ${requestQueue}<form id="customer-search" class="search-bar"><input name="q" type="search" required placeholder="Email, UID, Stripe customer/payment, or store transaction" value="${escapeHtml(c?.user?.email || "")}"><button class="button primary">Search</button></form>${detail}`;
}

function renderBilling(data) {
  const labels = { monthly: "MOBILE MONTHLY", polyglot: "POLYGLOT PERMANENT", premium: "PREMIUM LIFETIME" };
  const cards = ["monthly", "polyglot", "premium"].map((kind) => { const offer = data[kind]; const channel = kind === "premium" ? `Stripe: ${escapeHtml(offer.stripePriceId)}` : "Managed in Google Play / App Store Connect"; return `<article class="price-card"><p>${labels[kind]}</p><strong>${formatMoney(offer.unitAmount, offer.currency)}</strong><span>${kind === "monthly" ? "per month" : "one time"}</span><small>${channel}</small></article>`; }).join("");
  const regional = data.regionalPrices || {};
  const currencies = [...new Set(["USD", ...Object.keys(regional.monthly || {}), ...Object.keys(regional.polyglot || {}), ...Object.keys(regional.premium || {})])].sort((a, b) => a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b));
  const regionalRows = currencies.map((currency) => [currency, regional.monthly?.[currency] ?? "—", regional.polyglot?.[currency] ?? "—", regional.premium?.[currency] ?? "—"]);
  return `${pageIntro("BILLING CONTROL", "Storefront prices stay in their proper channel.", "Premium Lifetime is website-only and uses Stripe. Mobile Monthly and Polyglot Permanent are sold natively in Google Play and the App Store.")}
  <section class="price-grid">${cards}</section><section class="split-grid"><article class="panel form-panel"><header><div><p class="section-kicker">PREMIUM STRIPE PRICE</p><h3>Preview a Premium Lifetime price</h3></div></header><form id="price-form" class="stack-form"><input type="hidden" name="kind" value="premium"><div class="field-row"><label>Amount<input name="amount" inputmode="decimal" required placeholder="59.99"></label><label>Currency<input name="currency" value="USD" maxlength="3" required></label></div><button class="button primary">Preview change</button></form><div id="price-preview"></div></article>
  <article class="panel policy-card"><header><div><p class="section-kicker">POLICY</p><h3>What changes—and what does not</h3></div></header><ul class="policy-list"><li>This editor changes only the website-only Premium Lifetime Stripe price.</li><li>Mobile Monthly and Polyglot Permanent prices remain managed in Google Play and App Store Connect.</li><li>Only new Premium checkouts use the new price.</li><li>Old Stripe Prices remain available for webhook and refund history.</li><li>Historical Stripe subscriptions remain recognized; they are never silently migrated.</li><li>Historical chapter purchases completed by ${formatDate(data.notes?.legacyChapterUpgradeCutoff || "2026-08-24T23:59:59.999Z")} receive a separate, idempotent Polyglot Permanent grant for their original mobile platform.</li><li>A second typed confirmation is required.</li><li>Test deployments refuse every live Stripe key.</li></ul></article></section>
  <section class="panel spaced"><header><div><p class="section-kicker">APPROVED REGIONAL PRICES</p><h3>Storefront price reference</h3></div></header><p class="panel-copy">Amounts are shown in major currency units. Monthly and Polyglot values are references for Google Play and App Store Connect; Premium values are for Stripe.</p>${table(["Currency", "Monthly (native)", "Polyglot (native)", "Premium (Stripe)"], regionalRows)}</section>`;
}

function renderImports() {
  return `${pageIntro("CUSTOMER MIGRATION", "Import without surprises.", "Paste CSV or choose a file, validate every row, then type a confirmation before anything is applied.", '<button class="button secondary" data-action="download-template">Download template</button>')}
  <section class="panel form-panel"><header><div><p class="section-kicker">CSV DRY RUN</p><h3>Purchase and entitlement import</h3></div><span class="state-pill">Maximum 500 rows</span></header><form id="import-form" class="stack-form"><label>CSV file<input id="import-file" type="file" accept=".csv,text/csv"></label><label>CSV rows<textarea name="csv" class="code-input" rows="12" required placeholder="email,kind,externalId,mobilePlatform,startsAt,endsAt,note&#10;person@example.com,mobile_polyglot_permanent,order_123,android,,,Historical permanent purchase"></textarea></label><button class="button primary">Validate import</button></form><div id="import-preview"></div></section>
  <section class="panel info-strip"><strong>Unknown email?</strong><p>The record waits for that exact verified email to sign in with Google or Apple. The importer never creates insecure placeholder accounts.</p></section>`;
}

function renderOperations(data) {
  const outbox = (data.outbox || []).map((j) => [formatDate(j.createdAt), j.kind, j.state, j.attemptCount ?? 0, jsonCell(j.lastError), j.state === "failed" ? htmlCell(`<button class="text-button" data-retry-job="${escapeHtml(j.id)}">Retry</button>`) : "—"]);
  const events = (data.providerEvents || []).map((e) => [formatDate(e.receivedAt), e.provider, e.eventType, e.status, jsonCell(e.lastError), e.status === "failed" ? htmlCell(`<button class="text-button" data-release-event="${escapeHtml(e.id)}">Release</button>`) : "—"]);
  const reconciliation = (data.reconciliationRuns || []).map((r) => [formatDate(r.startedAt), r.state, r.attempted ?? 0, r.succeeded ?? 0, r.failed ?? 0, r.providerAccess || "read_only"]);
  const tokenKeys = (data.providerTokenVault?.keys || []).map((k) => [k.keyId, k.tokens]);
  const storage = data.cloudStorage;
  const cleanup = data.cloudSaveCleanup || { pending: 0, processing: 0, failed: 0 };
  const deviceSignIn = data.deviceSignIn || { pending: 0, approved: 0, issuing: 0, consumed: 0, expired: 0 };
  const cleanupFailures = (cleanup.failures || []).map((job) => [formatDate(job.lastAttemptAt || job.createdAt), job.id, job.attemptCount ?? 0, job.lastError, htmlCell(`<button class="text-button" data-retry-cleanup="${escapeHtml(job.id)}">Retry</button>`)]);
  return `${pageIntro("DELIVERY CONTROL", "Every side effect is traceable.", "Webhook ingestion, asynchronous work, and read-only provider reconciliation are idempotent. Only terminal failures can be manually retried.")}
  <section class="panel"><header><div><p class="section-kicker">SUBSCRIPTION RECONCILIATION</p><h3>Missed-webhook safety</h3></div></header>${table(["Started", "State", "Checked", "Succeeded", "Failed", "Provider access"], reconciliation)}</section>
  <section class="panel spaced"><header><div><p class="section-kicker">PROVIDER TOKEN VAULT</p><h3>${Number(data.providerTokenVault?.encryptedTokens || 0).toLocaleString()} encrypted Play subscription tokens</h3></div></header><p class="panel-copy">Only key identifiers and token counts are visible here; purchase tokens and key material never leave the server vault.</p>${table(["Encryption key ID", "Tokens"], tokenKeys)}</section>
  <section class="panel spaced"><header><div><p class="section-kicker">PC/MAC SIGN-IN</p><h3>Privacy-safe device-code activity</h3></div></header><p class="panel-copy">Only aggregate session states are exposed. Codes, polling secrets, device labels and player identities never appear in Operations.</p>${table(["State", "Sessions", "Meaning"], [["Pending", deviceSignIn.pending, "Waiting for account approval"], ["Approved", deviceSignIn.approved, "Approved but not collected"], ["Issuing", deviceSignIn.issuing, "One-time token lease in progress"], ["Consumed", deviceSignIn.consumed, "Completed; awaiting scheduled cleanup"], ["Expired", deviceSignIn.expired, "Expired; awaiting scheduled cleanup"]])}</section>
  <section class="panel spaced"><header><div><p class="section-kicker">CLOUD STORAGE</p><h3>${storage ? formatBytes(storage.totalBytes) : "No inventory snapshot yet"}</h3></div><span class="state-pill">${data.cloudStorageMonitor?.state === "failed" ? "Monitor failed" : storage ? formatDate(storage.capturedAt) : "Monitoring off"}</span></header>${data.cloudStorageMonitor?.state === "failed" ? `<p class="panel-copy">${escapeHtml(data.cloudStorageMonitor.lastError || "Cloud Storage inventory request failed.")}</p>` : ""}${storage ? table(["Inventory", "Objects", "Bytes", "Needs attention"], [["Immutable revisions", storage.revisionObjects, formatBytes(storage.revisionBytes), "—"], ["Staging uploads", storage.stagingObjects, formatBytes(storage.stagingBytes), storage.staleStagingObjects ? `${storage.staleStagingObjects} stale · ${formatBytes(storage.staleStagingBytes)}` : "None"], ["Daily change", "—", formatBytes(storage.dailyChangeBytes), storage.growthAlert ? "Over threshold" : "Within threshold"]]) : empty("Enable the isolated monitor only after Firebase Storage is provisioned.")}${table(["Revision cleanup queue", "Jobs", "Status"], [["Pending", cleanup.pending, "Waiting"], ["Processing", cleanup.processing, "Leased"], ["Failed", cleanup.failed, cleanup.failed ? "Needs attention" : "Clear"], ["Last worker run", cleanup.monitor?.scanned ?? "—", cleanup.monitor?.state ? `${cleanup.monitor.state} · ${formatDate(cleanup.monitor.lastRunAt)}` : "Worker off"]])}${cleanup.monitor?.state === "failed" ? `<p class="panel-copy">Cloud-save cleanup worker failed. Review the scheduled function and Firebase IAM/billing.</p>` : ""}${cleanupFailures.length ? `<h4>Failed revision cleanup</h4>${table(["Last attempt", "Job", "Attempts", "Last error", "Action"], cleanupFailures)}` : ""}</section>
  <section class="panel spaced"><header><div><p class="section-kicker">OUTBOX</p><h3>Queued operations</h3></div></header>${table(["Created", "Kind", "State", "Attempts", "Last error", "Action"], outbox)}</section>
  <section class="panel spaced"><header><div><p class="section-kicker">PROVIDER EVENTS</p><h3>Webhook ledger</h3></div></header>${table(["Received", "Provider", "Type", "Status", "Last error", "Action"], events)}</section>`;
}

function renderInventory(data) {
  return `${pageIntro("KEY INVENTORY", "Know before stock runs out.", "Steam and Itch keys remain separate from mobile entitlements. Each sheet tab uses its configured low-stock threshold.")}
  <section class="inventory-grid">${(data.summary || []).length ? data.summary.map((r) => `<article class="inventory-card ${r.lowStock ? "low" : ""}"><p>${escapeHtml(r.sheetTab)}</p><strong>${Number(r.available).toLocaleString()}</strong><span>available</span><small>${Number(r.assigned).toLocaleString()} assigned · alert at ${Number(r.lowStockThreshold).toLocaleString()}</small></article>`).join("") : empty("No key inventory records in this environment.")}</section>
  <section class="panel"><header><div><p class="section-kicker">RECENT FULFILLMENT</p><h3>Delivered key orders</h3></div></header>${(data.recentFulfillments || []).length ? table(["When", "Order", "Keys"], data.recentFulfillments.map((r) => [formatDate(r.createdAt), r.orderId, (r.keys || []).length])) : empty("No fulfillment records in this environment.")}</section>`;
}

function renderAudit(data) {
  return `${pageIntro("ADMIN AUDIT", "A record of every sensitive action.", "Price changes, refunds, imports, grants, account controls and retries include the acting administrator and reason.")}
  <section class="panel"><header><div><p class="section-kicker">IMMUTABLE HISTORY</p><h3>Latest actions</h3></div></header>${table(["When", "Administrator", "Action", "Target", "Summary"], (data.entries || []).map((e) => [formatDate(e.createdAt), e.actorEmail, e.action, `${e.targetType}:${e.targetId}`, e.summary]))}</section>`;
}

function diagnosticDetails(check) {
  if ((check.issues || []).length) return check.issues.join(" ");
  const values = Object.entries(check.details || {}).filter(([, value]) => value !== null && value !== "" && (!Array.isArray(value) || value.length));
  if (!values.length) return "No issues found";
  return values.map(([key, value]) => `${key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase())}: ${Array.isArray(value) ? value.join(", ") : value}`).join(" · ");
}

function renderSettings(data) {
  const labels = { STRIPE_WEBHOOKS_ENABLED: "Stripe webhooks", GOOGLE_PLAY_WEBHOOKS_ENABLED: "Google Play webhooks", APPLE_WEBHOOKS_ENABLED: "Apple webhooks", OUTBOX_PROCESSING_ENABLED: "Outbox worker", AD_CONVERSIONS_ENABLED: "Ad conversions", LEGACY_FULFILLMENT_ENABLED: "Legacy fulfillment", SUBSCRIPTION_CANCELLATION_ENABLED: "Subscription cancellation", ACCOUNT_DELETION_PROCESSING_ENABLED: "Account deletion purge", STRIPE_MUTATIONS_ENABLED: "Stripe mutations", APP_CHECK_ENFORCEMENT_ENABLED: "Firebase App Check", SUBSCRIPTION_RECONCILIATION_ENABLED: "Subscription reconciliation", CLOUD_STORAGE_MONITORING_ENABLED: "Cloud storage monitoring", CLOUD_SAVE_CLEANUP_ENABLED: "Cloud-save revision cleanup", DEVICE_SIGN_IN_ENABLED: "PC/Mac device sign-in", DEVICE_SIGN_IN_CLEANUP_ENABLED: "Expired device-code cleanup", ADMIN_BOOTSTRAP_ENABLED: "Initial admin bootstrap" };
  const controls = data.controls || {};
  const diagnostic = state.stripeDiagnostic;
  const playDiagnostic = state.googlePlayDiagnostic;
  const authDiagnostic = state.firebaseAuthDiagnostic;
  const appleDiagnostic = state.appleCatalogDiagnostic;
  const diagnosticRows = (diagnostic?.checks || []).map((check) => [check.label, check.resourceId, check.state === "passed" ? "Passed" : "Failed", diagnosticDetails(check)]);
  const playDiagnosticRows = (playDiagnostic?.checks || []).map((check) => [check.label, check.resourceId, check.state === "passed" ? "Passed" : "Failed", diagnosticDetails(check)]);
  const authDiagnosticRows = (authDiagnostic?.checks || []).map((check) => [check.label, check.resourceId, check.state === "passed" ? "Passed" : "Failed", diagnosticDetails(check)]);
  const appleDiagnosticRows = (appleDiagnostic?.checks || []).map((check) => [check.label, check.resourceId, check.state === "passed" ? "Passed" : "Failed", diagnosticDetails(check)]);
  return `${pageIntro("SECURITY & SETUP", "Test mode is enforced by the server.", "The visible label is informational; secret-key mode and administrator claims are validated on every protected request.")}
  <section class="settings-grid"><article class="panel detail-card"><header><div><p class="section-kicker">ADMIN SESSION</p><h3>${escapeHtml(data.actor?.email || state.user?.email)}</h3></div></header><dl class="definition-grid"><div><dt>Firebase UID</dt><dd>${escapeHtml(data.actor?.uid || "Demo")}</dd></div><div><dt>Signed in through</dt><dd>${escapeHtml((data.providers || ["demo"]).join(", "))}</dd></div><div><dt>Authorization</dt><dd>Server-verified admin claim</dd></div><div><dt>Capabilities</dt><dd>${escapeHtml((data.capabilities || []).join(", "))}</dd></div></dl></article>
  <article class="panel"><header><div><p class="section-kicker">DEPLOYMENT GUARDS</p><h3>${escapeHtml(controls.APP_ENVIRONMENT || state.config.environment || "Unknown")} environment</h3></div></header><div class="guard-list">${Object.entries(labels).map(([key, label]) => `<div><span>${label}</span><b>${controls[key] ? "On" : "Off"}</b></div>`).join("")}</div></article></section>
  <section class="panel spaced"><header><div><p class="section-kicker">READ-ONLY PROVIDER CHECK</p><h3>Stripe catalog diagnostic</h3></div><button type="button" class="button secondary" data-run-stripe-diagnostic>${diagnostic ? "Run again" : "Run diagnostic"}</button></header><p class="panel-copy">Reads the configured test Prices, Products and historical-owner Coupon. It never creates a customer, Checkout Session, refund, subscription or webhook event and it never returns the API key.</p>${diagnostic ? `<div class="guard-list"><div><span>Credential</span><b>${escapeHtml(`${diagnostic.keyType} ${diagnostic.mode}`)}</b></div><div><span>Result</span><b>${diagnostic.passed ? "Passed" : "Needs attention"}</b></div><div><span>Checked</span><b>${escapeHtml(formatDate(diagnostic.checkedAt))}</b></div><div><span>Stripe canary switches</span><b>${diagnostic.canarySwitches?.checkoutTestingEnabled ? "On" : "Off"}</b></div></div>${table(["Check", "Resource", "State", "Details"], diagnosticRows)}` : empty("No provider call has been made from this page. Run the diagnostic after the restricted test key is installed.")}</section>
  <section class="panel spaced"><header><div><p class="section-kicker">READ-ONLY PROVIDER CHECK</p><h3>Google Play catalog diagnostic</h3></div><button type="button" class="button secondary" data-run-google-play-diagnostic>${playDiagnostic ? "Run again" : "Run diagnostic"}</button></header><p class="panel-copy">Reads Mobile Monthly, its three-day trial, and both wonderlangfull purchase options. During the pre-update rollout it requires legacy buy to remain active at USD 25.99 and buy-polyglot-permanent to remain draft at USD 31.99. It never acknowledges a purchase or changes Play Console data.</p>${playDiagnostic ? `<div class="guard-list"><div><span>Package</span><b>${escapeHtml(playDiagnostic.packageName)}</b></div><div><span>Result</span><b>${playDiagnostic.passed ? "Passed" : "Needs attention"}</b></div><div><span>Expected rollout</span><b>${escapeHtml(playDiagnostic.rolloutPhase === "compatible_update_live" ? "Compatible update live" : "Legacy live · new option draft")}</b></div><div><span>Play webhook processing</span><b>${playDiagnostic.webhookProcessingEnabled ? "On" : "Off"}</b></div></div>${table(["Check", "Resource", "State", "Details"], playDiagnosticRows)}` : empty("No Google Play provider call has been made from this page.")}</section>
  <section class="panel spaced"><header><div><p class="section-kicker">READ-ONLY PROVIDER CHECK</p><h3>Firebase Authentication diagnostic</h3></div><button type="button" class="button secondary" data-run-firebase-auth-diagnostic>${authDiagnostic ? "Run again" : "Run diagnostic"}</button></header><p class="panel-copy">Reads the WonderLang account project, authorized domains, passwordless-email policy, account privacy controls, Google provider and Apple provider. It discards all provider secrets and never changes Firebase Authentication.</p>${authDiagnostic ? `<div class="guard-list"><div><span>Project</span><b>${escapeHtml(authDiagnostic.projectId)}</b></div><div><span>Result</span><b>${authDiagnostic.passed ? "Passed" : "Needs attention"}</b></div><div><span>Mode</span><b>Read only</b></div></div>${table(["Check", "Resource", "State", "Details"], authDiagnosticRows)}` : empty("No Firebase Authentication provider call has been made from this page.")}</section>
  <section class="panel spaced"><header><div><p class="section-kicker">READ-ONLY PROVIDER CHECK</p><h3>Apple catalog diagnostic</h3></div><button type="button" class="button secondary" data-run-apple-catalog-diagnostic>${appleDiagnostic ? "Run again" : "Run diagnostic"}</button></header><p class="panel-copy">Reads the App Store app, Mobile Monthly, its current three-day trial, Polyglot Permanent and all four restore-only chapter products. It uses two-minute read-only App Store Connect authorization, discards the token and private key, and never changes Apple products.</p>${appleDiagnostic ? `<div class="guard-list"><div><span>App</span><b>${escapeHtml(appleDiagnostic.appId)}</b></div><div><span>Bundle</span><b>${escapeHtml(appleDiagnostic.bundleId)}</b></div><div><span>Result</span><b>${appleDiagnostic.passed ? "Passed" : "Needs attention"}</b></div><div><span>Mode</span><b>Read only</b></div></div>${table(["Check", "Resource", "State", "Details"], appleDiagnosticRows)}` : empty("No App Store Connect provider call has been made from this page. A separate server API key is required.")}</section>
  <section class="panel spaced"><header><div><p class="section-kicker">SSO READINESS</p><h3>Google and Apple</h3></div></header><ul class="policy-list"><li>Both providers use Firebase Authentication.</li><li>Signing in never grants admin access by itself.</li><li>Google and Apple identities merge only through verified account-linking rules.</li><li>The Netlify domain must be authorized in Firebase and Apple Services ID settings.</li></ul></section>`;
}

function table(headers, rows) { if (!rows.length) return empty("No records in this environment."); return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell && typeof cell === "object" && Object.hasOwn(cell, TRUSTED_HTML_CELL) ? cell[TRUSTED_HTML_CELL] : escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`; }
function toast(message, error = false) { const node = document.querySelector("#toast"); if (!node) return; node.textContent = message; node.className = `toast show${error ? " error" : ""}`; setTimeout(() => node.classList.remove("show"), 4500); }

async function api(path, options = {}) {
  if (demo) return demoApi(path, options);
  const token = await state.auth.currentUser.getIdToken(true);
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  if (state.appCheck) {
    try {
      const appCheckToken = await getAppCheckToken(state.appCheck, false);
      if (appCheckToken.token) headers["x-firebase-appcheck"] = appCheckToken.token;
    } catch {
      // App Check remains fail-open until every shipping client has been registered and tested.
    }
  }
  const response = await fetch(path, { method: options.method || "GET", headers, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}
function demoApi(path, options) {
  const method = options.method || "GET";
  if (path.includes("overview")) return demoOverview;
  if (method === "GET" && path === endpoints.secondPlatformRequests) {
    return { requests: ["pending", "approving"].includes(demoSecondPlatformRequest.state) ? [demoSecondPlatformRequest] : [] };
  }
  const secondPlatformDecision = path.match(/^\/admin-api\/v1\/second-platform-requests\/([^/]+)\/(approve|decline)$/);
  if (method === "POST" && secondPlatformDecision) {
    const uid = decodeURIComponent(secondPlatformDecision[1]);
    const decision = secondPlatformDecision[2];
    if (uid !== demoSecondPlatformRequest.uid) throw new Error("Demo Premium request no longer exists.");
    if (!["pending", "approving"].includes(demoSecondPlatformRequest.state)) throw new Error("This demo Premium request has already been decided.");
    const now = new Date().toISOString();
    demoSecondPlatformRequest.state = decision === "approve" ? "approved" : "declined";
    demoSecondPlatformRequest.updatedAt = now;
    demoSecondPlatformRequest.decisionAt = now;
    demoSecondPlatformRequest.approvalLeaseUntil = null;
    if (decision === "approve") {
      const platform = demoSecondPlatformRequest.requestedPlatform;
      const grantId = `grant_demo_premium_second_${platform}`;
      if (!demoCustomer.grants.some((grant) => grant.id === grantId)) {
        demoCustomer.grants.unshift({
          id: grantId,
          provider: "admin",
          providerTransactionId: `premium-second-platform:${uid}:${platform}`,
          product: "mobile_polyglot_permanent",
          state: "active",
          startsAt: now,
          metadata: { mobilePlatform: platform, premiumSecondPlatformRequest: true }
        });
      }
      syncDemoCustomerEntitlements();
      addDemoAudit("second_platform_request.approve", "secondPlatformRequest", uid, `Approved fictional ${platform} permanent access in the safe demo`);
    } else {
      addDemoAudit("second_platform_request.decline", "secondPlatformRequest", uid, "Declined the fictional Premium request in the safe demo");
    }
    return demoCustomer;
  }
  if (method === "POST" && /\/customers\/[^/]+\/grants$/.test(path)) {
    const product = String(options.body?.product || "mobile_polyglot_permanent");
    const id = `grant_demo_${crypto.randomUUID()}`;
    demoCustomer.grants.unshift({
      id,
      provider: "admin",
      providerTransactionId: `admin:${id}`,
      product,
      state: "active",
      startsAt: new Date().toISOString(),
      metadata: { mobilePlatform: options.body?.mobilePlatform || "android" }
    });
    syncDemoCustomerEntitlements();
    addDemoAudit("grant.create", "grant", id, `Granted ${product} in the safe demo`);
    return { id, state: "active" };
  }
  if (method === "POST" && /\/customers\/[^/]+\/access$/.test(path)) {
    demoCustomer.user.disabled = Boolean(options.body?.disabled);
    addDemoAudit("user.access.update", "user", demoCustomer.user.uid, demoCustomer.user.disabled ? "Disabled demo account" : "Enabled demo account");
    return { disabled: demoCustomer.user.disabled };
  }
  if (method === "POST" && /\/customers\/[^/]+\/revoke-sessions$/.test(path)) {
    addDemoAudit("user.sessions.revoke", "user", demoCustomer.user.uid, "Revoked demo sessions");
    return { revoked: true };
  }
  if (method === "POST" && /\/customers\/[^/]+\/cancel-deletion$/.test(path)) {
    demoCustomer.deletionRequest = null;
    demoCustomer.user.disabled = false;
    addDemoAudit("account.deletion.cancel", "user", demoCustomer.user.uid, "Canceled demo account deletion");
    return { state: "canceled" };
  }
  if (method === "POST" && /\/grants\/[^/]+\/revoke$/.test(path)) {
    const id = decodeURIComponent(path.split("/").at(-2) || "");
    const grant = demoCustomer.grants.find((row) => row.id === id);
    if (!grant || grant.provider !== "admin" || grant.state !== "active") throw new Error("Only an active demo administrator grant can be revoked.");
    grant.state = "revoked";
    syncDemoCustomerEntitlements();
    addDemoAudit("grant.revoke", "grant", id, "Revoked demo administrator grant");
    return { revoked: true };
  }
  if (method === "GET" && path.includes("customers")) return demoCustomer;
  if (method === "GET" && path.includes("diagnostics/stripe-catalog")) return {
    checkedAt: new Date().toISOString(), mode: "test", keyType: "restricted", passed: true, readOnly: true,
    canarySwitches: { stripeMutations: false, stripeWebhooks: false, checkoutTestingEnabled: false },
    checks: [
      ["monthly-price", "Mobile Monthly Stripe history Price", "price_test_monthly"],
      ["polyglot-price", "Polyglot Stripe history Price", "price_test_polyglot"],
      ["premium-price", "Premium Lifetime checkout Price", "price_test_premium"],
      ["historical-owner-coupon", "Historical desktop-owner 50% Coupon", "wonderlang_desktop_owner_lifetime_50"]
    ].map(([id, label, resourceId]) => ({ id, label, resourceId, state: "passed", issues: [], details: { livemode: false } }))
  };
  if (method === "GET" && path.includes("diagnostics/google-play-catalog")) return {
    checkedAt: new Date().toISOString(), passed: true, readOnly: true, packageName: "com.wonderlang.app",
    rolloutPhase: "legacy_live_new_draft", webhookProcessingEnabled: false,
    checks: [
      { id: "monthly-base-plan", label: "Mobile Monthly base plan", resourceId: "wonderlangmonthly/monthly", state: "passed", issues: [], details: { state: "ACTIVE", usPrice: "USD 6.99" } },
      { id: "monthly-three-day-trial", label: "Mobile Monthly three-day trial", resourceId: "three-day-trial", state: "passed", issues: [], details: { state: "ACTIVE", duration: "P3D" } },
      { id: "legacy-buy-option", label: "Legacy wonderlangfull purchase option", resourceId: "buy", state: "passed", issues: [], details: { state: "ACTIVE", usPrice: "USD 25.99" } },
      { id: "polyglot-purchase-option", label: "Polyglot Permanent purchase option", resourceId: "buy-polyglot-permanent", state: "passed", issues: [], details: { state: "DRAFT", usPrice: "USD 31.99" } }
    ]
  };
  if (method === "GET" && path.includes("diagnostics/firebase-authentication")) return {
    checkedAt: new Date().toISOString(), passed: false, readOnly: true, projectId: "wonderlang-accounts",
    checks: [
      { id: "project-domains", label: "WonderLang account project and authorized domains", resourceId: "projects/wonderlang-accounts/config", state: "passed", issues: [], details: { missingDomains: [] } },
      { id: "passwordless-email", label: "Passwordless email sign-in", resourceId: "emailLink", state: "passed", issues: [], details: { emailEnabled: true, passwordRequired: false } },
      { id: "account-safety", label: "Account creation, linking and privacy policy", resourceId: "accountPolicy", state: "passed", issues: [], details: { separateProviderAccounts: true, userSignupEnabled: true, userDeletionEnabled: true, emailEnumerationProtection: true } },
      { id: "google-provider", label: "Google sign-in provider", resourceId: "google.com", state: "passed", issues: [], details: { enabled: true, oauthClientConfigured: true } },
      { id: "apple-provider", label: "Apple sign-in provider", resourceId: "apple.com", state: "failed", issues: ["Apple is not configured as a Firebase sign-in provider."], details: { enabled: false, serviceIdMatches: false, bundleIdPresent: false, codeFlowCredentialsComplete: false } }
    ]
  };
  if (method === "GET" && path.includes("diagnostics/apple-catalog")) return {
    checkedAt: new Date().toISOString(), passed: true, readOnly: true, appId: "6780447024", bundleId: "com.wonderlang.app",
    checks: [
      { id: "app", label: "WonderLang App Store app", resourceId: "6780447024", state: "passed", issues: [], details: { name: "WonderLang", bundleId: "com.wonderlang.app" } },
      { id: "monthly", label: "Mobile Monthly subscription", resourceId: "wonderlangmonthly", state: "passed", issues: [], details: { subscriptionGroupId: "22331966", state: "READY_TO_SUBMIT", period: "ONE_MONTH", usPrice: "USD 6.99" } },
      { id: "trial", label: "Mobile Monthly three-day trial", resourceId: "6804702003", state: "passed", issues: [], details: { active: true, duration: "THREE_DAYS", mode: "FREE_TRIAL", numberOfPeriods: 1 } },
      { id: "polyglot", label: "Polyglot Permanent non-consumable", resourceId: "wonderlangfull", state: "passed", issues: [], details: { type: "NON_CONSUMABLE", state: "APPROVED", usPrice: "USD 31.99" } },
      { id: "historical", label: "Historical chapter restore products", resourceId: "restore-only chapters", state: "passed", issues: [], details: { expectedProductIds: ["wonderlangch1", "wonderlangch2", "wonderlangch3", "wonderlangch4"], presentProductIds: ["wonderlangch1", "wonderlangch2", "wonderlangch3", "wonderlangch4"], newSalesRequired: false } }
    ]
  };
  if (path.endsWith("/catalog")) return demoCatalog;
  if (path.includes("operations")) return demoOperations;
  if (path.includes("inventory")) return demoInventory;
  if (path.includes("audit")) return demoAudit;
  if (path.includes("session")) return { actor: { uid: "demo_admin", email: state.user.email }, providers: ["google.com"], capabilities: Object.keys(views), controls: { APP_ENVIRONMENT: "test", STRIPE_WEBHOOKS_ENABLED: false, GOOGLE_PLAY_WEBHOOKS_ENABLED: false, APPLE_WEBHOOKS_ENABLED: false, OUTBOX_PROCESSING_ENABLED: false, AD_CONVERSIONS_ENABLED: false, LEGACY_FULFILLMENT_ENABLED: false, SUBSCRIPTION_CANCELLATION_ENABLED: false, ACCOUNT_DELETION_PROCESSING_ENABLED: false, STRIPE_MUTATIONS_ENABLED: false, APP_CHECK_ENFORCEMENT_ENABLED: false, SUBSCRIPTION_RECONCILIATION_ENABLED: false, CLOUD_STORAGE_MONITORING_ENABLED: false, CLOUD_SAVE_CLEANUP_ENABLED: false, DEVICE_SIGN_IN_ENABLED: false, DEVICE_SIGN_IN_CLEANUP_ENABLED: false, ADMIN_BOOTSTRAP_ENABLED: false } };
  if (path.includes("price-preview")) {
    const kind = String(options.body?.kind || "monthly").toLowerCase();
    const currency = String(options.body?.currency || "USD").toUpperCase();
    const unitAmount = Number(options.body?.unitAmount);
    return {
      previewId: crypto.randomUUID(),
      kind,
      unitAmount,
      currency,
      confirmationPhrase: `CHANGE ${kind.toUpperCase()} TO ${majorAmount(currency, unitAmount)} ${currency}`,
      warning: "Existing subscribers keep their current price."
    };
  }
  if (path.includes("price-commit")) {
    const preview = demoConfirmed(options, state.previews.price);
    const kind = preview.kind;
    if (!demoCatalog[kind]) throw new Error("Unknown demo catalog offer.");
    demoCatalog.regionalPrices[kind][preview.currency] = majorAmount(preview.currency, preview.unitAmount);
    demoCatalog[kind] = {
      ...demoCatalog[kind],
      unitAmount: minorAmount("USD", demoCatalog.regionalPrices[kind].USD),
      currency: "USD",
      stripePriceId: `price_demo_${crypto.randomUUID()}`
    };
    demoCatalog.revision += 1;
    addDemoAudit("catalog.price.change", "catalog", kind, `Changed demo ${kind} price for new checkouts`);
    return demoCatalog[kind];
  }
  if (path.includes("refunds/preview")) {
    const requestedAmount = Number(options.body?.amount);
    const refundableAmount = demoCustomer.payments[0].refundableAmount;
    const amount = Number.isSafeInteger(requestedAmount) && requestedAmount > 0 ? requestedAmount : refundableAmount;
    return {
      previewId: crypto.randomUUID(),
      paymentIntentId: demoCustomer.payments[0].id,
      amount,
      currency: "USD",
      confirmationPhrase: `REFUND ${(amount / 100).toFixed(2)} USD`,
      warnings: [
        "A refund does not cancel an active subscription.",
        amount < refundableAmount ? "A partial refund does not revoke access automatically." : "A full refund revokes the paid entitlement only after the verified Stripe webhook."
      ]
    };
  }
  if (path.includes("refunds/commit")) {
    const preview = demoConfirmed(options, state.previews.refund);
    const payment = demoCustomer.payments.find((row) => row.id === preview.paymentIntentId);
    if (!payment) throw new Error("Demo payment no longer exists.");
    payment.amountRefunded += preview.amount;
    payment.refundableAmount = Math.max(0, payment.amountReceived - payment.amountRefunded);
    payment.status = payment.refundableAmount ? "partially_refunded" : "refunded";
    addDemoAudit("stripe.refund.create", "paymentIntent", payment.id, `Refunded ${majorAmount(payment.currency, preview.amount)} ${payment.currency} in the safe demo`);
    return { refundId: `re_demo_${crypto.randomUUID()}`, status: "succeeded", amount: preview.amount, currency: preview.currency };
  }
  if (path.includes("imports/preview")) return { previewId: crypto.randomUUID(), confirmationPhrase: "IMPORT 1 RECORD", summary: { records: 1, existingAccounts: 0, pendingFirstSignIn: 1, entitlements: 1, discounts: 0 }, rows: options.body?.rows || [], warnings: ["Unknown emails wait for verified first sign-in."] };
  if (path.includes("imports/commit")) {
    const preview = demoConfirmed(options, state.previews.import);
    addDemoAudit("import.commit", "import", preview.previewId, "Applied one fictional import row in the safe demo");
    return { imported: preview.summary?.records || 1 };
  }
  if (method === "POST" && /\/outbox\/[^/]+\/retry$/.test(path)) {
    const id = decodeURIComponent(path.split("/").at(-2) || "");
    const job = demoOperations.outbox.find((row) => row.id === id);
    if (!job || job.state !== "failed") throw new Error("Only a failed demo job can be retried.");
    job.state = "pending";
    job.attemptCount = 0;
    job.lastError = null;
    addDemoAudit("outbox.retry", "outbox", id, "Queued demo job for retry");
    return { queued: true };
  }
  if (method === "POST" && /\/cloud-save-cleanup\/[^/]+\/retry$/.test(path)) {
    const id = decodeURIComponent(path.split("/").at(-2) || "");
    const job = demoOperations.cloudSaveCleanup.failures.find((row) => row.id === id);
    if (!job) throw new Error("Demo cleanup failure no longer exists.");
    demoOperations.cloudSaveCleanup.failures = demoOperations.cloudSaveCleanup.failures.filter((row) => row.id !== id);
    demoOperations.cloudSaveCleanup.failed = Math.max(0, demoOperations.cloudSaveCleanup.failed - 1);
    demoOperations.cloudSaveCleanup.pending += 1;
    addDemoAudit("cloud_save_cleanup.retry", "cloudSaveCleanupJob", id, "Queued demo cleanup for retry");
    return { queued: true };
  }
  if (method === "POST" && /\/customers\/[^/]+\/cloud-saves\/save(?:0|[1-9]|1[0-9]|20)\/download$/.test(path)) {
    const slot = decodeURIComponent(path.split("/").at(-2) || "save1");
    addDemoAudit("cloud_save.download", "user", demoCustomer.user.uid, `Downloaded fictional ${slot} in the safe demo`);
    return {
      demoPayload: { demo: true, slot },
      filename: `wonderlang-${slot}-demo.json`,
      expiresAt: new Date(Date.now() + 300_000).toISOString()
    };
  }
  if (method === "POST" && /\/provider-events\/[^/]+\/release$/.test(path)) {
    const id = decodeURIComponent(path.split("/").at(-2) || "");
    const event = demoOperations.providerEvents.find((row) => row.id === id);
    if (!event || event.status !== "failed") throw new Error("Only a failed demo event can be released.");
    event.status = "released";
    event.lastError = null;
    addDemoAudit("provider_event.release", "providerEvent", id, "Released demo provider event");
    return { released: true };
  }
  return { ok: true };
}

function demoConfirmed(options, preview) {
  if (!preview || options.body?.previewId !== preview.previewId) throw new Error("Preview expired. Create a fresh preview.");
  if (options.body?.confirmationPhrase !== preview.confirmationPhrase) throw new Error("Confirmation phrase does not match.");
  return preview;
}

function addDemoAudit(action, targetType, targetId, summary) {
  demoAudit.entries.unshift({ id: `audit_demo_${crypto.randomUUID()}`, actorEmail: state.user.email, action, targetType, targetId, summary, createdAt: new Date().toISOString() });
}

async function loadView(view) {
  state.view = view;
  appNode.innerHTML = shell(`<div class="loading">Loading ${escapeHtml(views[view])}…</div>`);
  bindShell();
  try {
    let data;
    if (view === "overview") data = await api(endpoints.overview);
    else if (view === "customers") {
      const result = await api(endpoints.secondPlatformRequests);
      state.secondPlatformRequests = result.requests || [];
    }
    else if (["billing", "operations", "inventory", "audit", "settings"].includes(view)) data = await api(endpoints[view]);
    const content = view === "overview" ? renderOverview(data) : view === "customers" ? renderCustomers() : view === "billing" ? renderBilling(data) : view === "imports" ? renderImports() : view === "operations" ? renderOperations(data) : view === "inventory" ? renderInventory(data) : view === "audit" ? renderAudit(data) : renderSettings(data);
    appNode.innerHTML = shell(content); bindShell(); bindView();
    if (state.notice) {
      const notice = state.notice;
      state.notice = null;
      toast(notice.message, notice.error);
    }
  } catch (error) { appNode.innerHTML = shell(`<section class="error-state"><h2>Could not load ${escapeHtml(views[view])}</h2><p>${escapeHtml(error.message)}</p><button class="button secondary" data-view="overview">Return to overview</button></section>`); bindShell(); toast(error.message, true); }
}

function bindShell() {
  document.querySelector('[data-action="sign-out"]')?.addEventListener("click", () => state.auth ? signOut(state.auth) : location.reload());
  document.querySelector(".mobile-menu")?.addEventListener("click", () => document.querySelector(".side-nav")?.classList.toggle("open"));
  document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => loadView(b.dataset.view)));
}

function formDialog({ title, copy, fields, confirmText, danger = false }) {
  return new Promise((resolve) => {
    const holder = document.createElement("div");
    const titleId = `dialog-${crypto.randomUUID()}`;
    holder.className = "modal-backdrop";
    holder.innerHTML = `<section class="confirm-modal form-modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <header class="dialog-header"><div><p class="section-kicker">REVIEW REQUIRED</p><h3 id="${titleId}">${escapeHtml(title)}</h3><p>${escapeHtml(copy)}</p></div></header>
      <form class="stack-form">${fields}<div class="dialog-actions"><button type="button" class="button secondary" data-close>Cancel</button><button class="button ${danger ? "danger" : "primary"}">${escapeHtml(confirmText)}</button></div></form>
    </section>`;
    let settled = false;
    const close = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeydown);
      holder.remove();
      resolve(value);
    };
    const onKeydown = (event) => { if (event.key === "Escape") close(null); };
    holder.querySelector("[data-close]").addEventListener("click", () => close(null));
    holder.querySelector("form").addEventListener("submit", (event) => { event.preventDefault(); close(new FormData(event.currentTarget)); });
    document.addEventListener("keydown", onKeydown);
    document.body.append(holder);
    holder.querySelector("input, select, textarea")?.focus();
  });
}

async function reason(message) {
  const data = await formDialog({
    title: "Record an audit reason",
    copy: message,
    fields: '<label>Reason<textarea name="reason" minlength="10" maxlength="500" required placeholder="Explain why this action is authorized."></textarea></label>',
    confirmText: "Continue",
    danger: true
  });
  return data ? String(data.get("reason")).trim() : null;
}
async function mutate(path, body, success) {
  try {
    await api(path, { method: "POST", body });
    state.notice = { message: success, error: false };
    return true;
  } catch (error) {
    state.notice = null;
    toast(error.message, true);
    return false;
  }
}

function bindView() {
  document.querySelectorAll("[data-second-platform-open]").forEach((button) => button.addEventListener("click", async () => {
    try {
      state.customer = await api(`/admin-api/v1/customers/${encodeURIComponent(button.dataset.secondPlatformOpen)}`);
      await loadView("customers");
    } catch (error) {
      toast(error.message, true);
    }
  }));
  document.querySelectorAll("[data-second-platform-decision]").forEach((button) => button.addEventListener("click", async () => {
    const decision = button.dataset.secondPlatformDecision;
    const requested = state.customer?.secondMobilePlatformRequest?.requestedPlatform === "ios" ? "iOS" : "Android";
    const auditReason = await reason(`${decision === "approve" ? "Why are you granting" : "Why are you declining"} this Premium customer's ${requested} request?`);
    if (!auditReason) return;
    const uid = button.dataset.requestUid;
    const success = decision === "approve" ? `${requested} permanent access granted.` : `${requested} request declined.`;
    if (await mutate(`/admin-api/v1/second-platform-requests/${encodeURIComponent(uid)}/${decision}`, { reason: auditReason }, success)) {
      state.customer = await api(`/admin-api/v1/customers/${encodeURIComponent(uid)}`);
      await loadView("customers");
    }
  }));
  document.querySelector("#customer-search")?.addEventListener("submit", async (event) => { event.preventDefault(); const q = new FormData(event.currentTarget).get("q"); try { state.customer = await api(`/admin-api/v1/customers/search?q=${encodeURIComponent(q)}`); await loadView("customers"); } catch (error) { toast(error.message, true); } });
  document.querySelector("#grant-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const f = new FormData(event.currentTarget); const body = { product: f.get("product"), reason: f.get("reason"), mobilePlatform: f.get("mobilePlatform"), ...(f.get("endsAt") ? { endsAt: new Date(f.get("endsAt")).toISOString() } : {}) }; if (await mutate(`/admin-api/v1/customers/${state.customer.user.uid}/grants`, body, "Access granted.")) { state.customer = await api(`/admin-api/v1/customers/${state.customer.user.uid}`); loadView("customers"); } });
  document.querySelectorAll("[data-revoke-grant]").forEach((b) => b.addEventListener("click", async () => { const r = await reason("Why are you revoking this manual grant?"); if (r && await mutate(`/admin-api/v1/grants/${b.dataset.revokeGrant}/revoke`, { reason: r }, "Grant revoked.")) { state.customer = await api(`/admin-api/v1/customers/${state.customer.user.uid}`); loadView("customers"); } }));
  document.querySelectorAll("[data-customer-action]").forEach((b) => b.addEventListener("click", async () => {
    const action = b.dataset.customerAction;
    const question = action === "sessions" ? "Why are you revoking all sessions?" : action === "cancel-deletion" ? "Why is this account-deletion request being canceled?" : `Why are you ${state.customer.user.disabled ? "enabling" : "disabling"} this account?`;
    const r = await reason(question); if (!r) return;
    const path = action === "sessions" ? "revoke-sessions" : action === "cancel-deletion" ? "cancel-deletion" : "access";
    const body = action === "access" ? { reason: r, disabled: !state.customer.user.disabled } : { reason: r };
    if (await mutate(`/admin-api/v1/customers/${state.customer.user.uid}/${path}`, body, action === "cancel-deletion" ? "Deletion canceled and account re-enabled." : "Account security updated.")) { state.customer = await api(`/admin-api/v1/customers/${state.customer.user.uid}`); loadView("customers"); }
  }));
  document.querySelectorAll("[data-refund]").forEach((b) => b.addEventListener("click", () => refundFlow(b)));
  document.querySelector("#price-form")?.addEventListener("submit", priceFlow);
  document.querySelector("#import-form")?.addEventListener("submit", importFlow);
  document.querySelector("#import-file")?.addEventListener("change", async (event) => { const file = event.target.files?.[0]; if (file) document.querySelector('[name="csv"]').value = await file.text(); });
  document.querySelector('[data-action="download-template"]')?.addEventListener("click", downloadTemplate);
  document.querySelector("[data-run-stripe-diagnostic]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      state.stripeDiagnostic = await api("/admin-api/v1/diagnostics/stripe-catalog");
      state.notice = { message: state.stripeDiagnostic.passed ? "Stripe catalog diagnostic passed." : "Stripe catalog diagnostic found issues.", error: !state.stripeDiagnostic.passed };
      await loadView("settings");
    } catch (error) {
      button.disabled = false;
      toast(error.message, true);
    }
  });
  document.querySelector("[data-run-google-play-diagnostic]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      state.googlePlayDiagnostic = await api("/admin-api/v1/diagnostics/google-play-catalog");
      state.notice = { message: state.googlePlayDiagnostic.passed ? "Google Play catalog diagnostic passed." : "Google Play catalog diagnostic found issues.", error: !state.googlePlayDiagnostic.passed };
      await loadView("settings");
    } catch (error) {
      button.disabled = false;
      toast(error.message, true);
    }
  });
  document.querySelector("[data-run-firebase-auth-diagnostic]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      state.firebaseAuthDiagnostic = await api("/admin-api/v1/diagnostics/firebase-authentication");
      state.notice = { message: state.firebaseAuthDiagnostic.passed ? "Firebase Authentication diagnostic passed." : "Firebase Authentication diagnostic found issues.", error: !state.firebaseAuthDiagnostic.passed };
      await loadView("settings");
    } catch (error) {
      button.disabled = false;
      toast(error.message, true);
    }
  });
  document.querySelector("[data-run-apple-catalog-diagnostic]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      state.appleCatalogDiagnostic = await api("/admin-api/v1/diagnostics/apple-catalog");
      state.notice = { message: state.appleCatalogDiagnostic.passed ? "Apple catalog diagnostic passed." : "Apple catalog diagnostic found issues.", error: !state.appleCatalogDiagnostic.passed };
      await loadView("settings");
    } catch (error) {
      button.disabled = false;
      toast(error.message, true);
    }
  });
  document.querySelectorAll("[data-retry-job]").forEach((b) => b.addEventListener("click", async () => { const r = await reason("Why should this terminal job be retried?"); if (r && await mutate(`/admin-api/v1/outbox/${b.dataset.retryJob}/retry`, { reason: r }, "Job queued for retry.")) loadView("operations"); }));
  document.querySelectorAll("[data-retry-cleanup]").forEach((b) => b.addEventListener("click", async () => { const r = await reason("Why should this failed cloud-save cleanup be retried?"); if (r && await mutate(`/admin-api/v1/cloud-save-cleanup/${b.dataset.retryCleanup}/retry`, { reason: r }, "Cloud-save cleanup queued for retry.")) loadView("operations"); }));
  document.querySelectorAll("[data-download-save]").forEach((button) => button.addEventListener("click", async () => {
    const supportReason = await reason(`Why do you need to download this customer's ${button.dataset.downloadSave}?`);
    if (!supportReason) return;
    button.disabled = true;
    try {
      const result = await api(`/admin-api/v1/customers/${encodeURIComponent(state.customer.user.uid)}/cloud-saves/${encodeURIComponent(button.dataset.downloadSave)}/download`, { method: "POST", body: { reason: supportReason } });
      let saveBlob;
      if (demo && result.demoPayload) {
        saveBlob = new Blob([JSON.stringify(result.demoPayload)], { type: "application/json" });
      } else {
        if (!result.downloadUrl) throw new Error("The private cloud-save download URL is unavailable.");
        const response = await fetch(result.downloadUrl);
        if (!response.ok) throw new Error(`Cloud-save download failed (${response.status}).`);
        saveBlob = await response.blob();
      }
      const objectUrl = URL.createObjectURL(saveBlob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = result.filename || `wonderlang-${button.dataset.downloadSave}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
      toast("Cloud save downloaded and recorded in Admin Audit.");
    } catch (error) { toast(error.message, true); }
    finally { button.disabled = false; }
  }));
  document.querySelectorAll("[data-release-event]").forEach((b) => b.addEventListener("click", async () => { const r = await reason("Why should this event be released for provider redelivery?"); if (r && await mutate(`/admin-api/v1/provider-events/${b.dataset.releaseEvent}/release`, { reason: r }, "Event released.")) loadView("operations"); }));
}

async function priceFlow(event) {
  event.preventDefault(); const f = new FormData(event.currentTarget); const currency = String(f.get("currency")).toUpperCase(); const amount = minorAmount(currency, f.get("amount"));
  try { const p = await api("/admin-api/v1/catalog/price-preview", { method: "POST", body: { kind: f.get("kind"), unitAmount: amount, currency } }); state.previews.price = p; document.querySelector("#price-preview").innerHTML = confirmPanel("Price preview", p.warning, p.confirmationPhrase, "confirm-price"); toast("Price preview ready."); document.querySelector("#confirm-price").addEventListener("submit", async (e) => { e.preventDefault(); const phrase = new FormData(e.currentTarget).get("phrase"); if (await mutate("/admin-api/v1/catalog/price-commit", { previewId: p.previewId, confirmationPhrase: phrase }, "Price changed for new checkouts.")) loadView("billing"); }); } catch (error) { toast(error.message, true); }
}
async function refundFlow(button) {
  const currencyCode = String(button.dataset.currency || "USD").toUpperCase();
  const currency = escapeHtml(currencyCode);
  const zeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currencyCode);
  const maximum = majorAmount(currencyCode, Number(button.dataset.amount));
  const data = await formDialog({
    title: "Prepare a Stripe refund",
    copy: `Review the amount and reason. The maximum shown is ${maximum} ${currencyCode}; leave amount blank to refund all remaining funds.`,
    fields: `<label>Amount (${currency})<input name="amount" type="number" inputmode="decimal" min="${zeroDecimal ? "1" : "0.01"}" max="${maximum}" step="${zeroDecimal ? "1" : "0.01"}" placeholder="All remaining funds"></label>
      <label>Stripe reason<select name="reason"><option value="requested_by_customer">Requested by customer</option><option value="duplicate">Duplicate</option><option value="fraudulent">Fraudulent</option></select></label>
      <label>Audit note<textarea name="note" minlength="10" maxlength="500" required placeholder="Explain why this refund is authorized."></textarea></label>`,
    confirmText: "Preview refund",
    danger: true
  });
  if (!data) return;
  const amountText = String(data.get("amount") || "").trim();
  const note = String(data.get("note") || "").trim();
  const refundReason = String(data.get("reason") || "requested_by_customer");
  try { const p = await api("/admin-api/v1/refunds/preview", { method: "POST", body: { uid: state.customer.user.uid, paymentIntentId: button.dataset.refund, ...(amountText ? { amount: minorAmount(currencyCode, amountText) } : {}), reason: refundReason, note } }); state.previews.refund = p; const holder = document.createElement("div"); holder.className = "modal-backdrop"; holder.innerHTML = `<div class="confirm-modal">${confirmPanel("Refund preview", (p.warnings || []).join(" "), p.confirmationPhrase, "confirm-refund")}<button class="button secondary" data-close>Cancel</button></div>`; document.body.append(holder); holder.querySelector("[data-close]").addEventListener("click", () => holder.remove()); holder.querySelector("#confirm-refund").addEventListener("submit", async (e) => { e.preventDefault(); const phrase = new FormData(e.currentTarget).get("phrase"); if (await mutate("/admin-api/v1/refunds/commit", { previewId: p.previewId, confirmationPhrase: phrase }, "Refund submitted to Stripe.")) { holder.remove(); state.customer = await api(`/admin-api/v1/customers/${state.customer.user.uid}`); loadView("customers"); } }); } catch (error) { toast(error.message, true); }
}
function confirmPanel(title, warning, phrase, id) { return `<div class="confirmation"><h4>${escapeHtml(title)}</h4><p>${escapeHtml(warning)}</p><code>${escapeHtml(phrase)}</code><form id="${id}" class="stack-form"><label>Type the phrase exactly<input name="phrase" required autocomplete="off"></label><button class="button danger">Confirm action</button></form></div>`; }
function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim()); if (lines.length < 2) throw new Error("CSV needs a header and at least one data row.");
  const cells = (line) => { const out = []; let value = "", quoted = false; for (let i = 0; i < line.length; i += 1) { const c = line[i]; if (c === '"' && quoted && line[i + 1] === '"') { value += '"'; i += 1; } else if (c === '"') quoted = !quoted; else if (c === "," && !quoted) { out.push(value.trim()); value = ""; } else value += c; } out.push(value.trim()); return out; };
  const headers = cells(lines[0]); const required = ["email", "kind", "externalId", "mobilePlatform", "startsAt", "endsAt", "note"]; if (required.some((h) => !headers.includes(h))) throw new Error(`CSV header must include: ${required.join(", ")}.`);
  return lines.slice(1).map((line) => { const values = cells(line); return Object.fromEntries(headers.map((h, i) => [h, values[i] || undefined])); }).map((r) => ({ email: r.email, kind: r.kind, externalId: r.externalId, note: r.note, ...(r.mobilePlatform ? { mobilePlatform: r.mobilePlatform } : {}), ...(r.startsAt ? { startsAt: new Date(r.startsAt).toISOString() } : {}), ...(r.endsAt ? { endsAt: new Date(r.endsAt).toISOString() } : {}) }));
}
async function importFlow(event) {
  event.preventDefault(); try { const rows = parseCsv(new FormData(event.currentTarget).get("csv")); const p = await api("/admin-api/v1/imports/preview", { method: "POST", body: { rows } }); state.previews.import = p; document.querySelector("#import-preview").innerHTML = `<div class="preview-summary">${Object.entries(p.summary).map(([k,v]) => `<div><span>${escapeHtml(k)}</span><strong>${Number(v)}</strong></div>`).join("")}</div>${confirmPanel("Import is ready", (p.warnings || []).join(" "), p.confirmationPhrase, "confirm-import")}`; toast("Import preview ready."); document.querySelector("#confirm-import").addEventListener("submit", async (e) => { e.preventDefault(); const phrase = new FormData(e.currentTarget).get("phrase"); if (await mutate("/admin-api/v1/imports/commit", { previewId: p.previewId, confirmationPhrase: phrase }, "Import completed.")) loadView("imports"); }); } catch (error) { toast(error.message, true); }
}
function downloadTemplate() { const csv = "email,kind,externalId,mobilePlatform,startsAt,endsAt,note\nperson@example.com,mobile_polyglot_permanent,order_123,android,,,Historical permanent purchase\n"; const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); const a = document.createElement("a"); a.href = url; a.download = "wonderlang-import-template.csv"; a.click(); URL.revokeObjectURL(url); }

function signInScreen(message = "Sign in with an approved WonderLang administrator account.") {
  appNode.innerHTML = `<main class="sign-in-page"><section class="sign-in-card"><span class="brand-mark large">W</span><p class="eyebrow">WONDERLANG OPERATIONS</p><h1>Run the business<br>without the busywork.</h1><p>${escapeHtml(message)}</p><div class="sign-in-actions"><button data-provider="google">Continue with Google</button><button class="apple" data-provider="apple">Continue with Apple</button></div><small>Access requires a server-verified Firebase administrator claim. Signing in alone never grants access.</small></section></main>`;
  document.querySelector('[data-provider="google"]')?.addEventListener("click", () => providerSignIn(new GoogleAuthProvider()));
  document.querySelector('[data-provider="apple"]')?.addEventListener("click", () => { const provider = new OAuthProvider("apple.com"); provider.addScope("email"); provider.addScope("name"); providerSignIn(provider); });
}
async function providerSignIn(provider) { try { await signInWithPopup(state.auth, provider); } catch (error) { if (["auth/popup-blocked", "auth/cancelled-popup-request", "auth/operation-not-supported-in-this-environment"].includes(error?.code)) return signInWithRedirect(state.auth, provider); signInScreen(error?.message || "Sign-in failed."); } }
async function start() {
  if (demo) return loadView("overview"); signInScreen("Loading secure sign-in…");
  try { const response = await fetch("/api/v1/config"); if (!response.ok) throw new Error("The account service is not configured yet."); state.config = await response.json(); const firebaseApp = initializeApp(state.config.firebase); if (state.config.appCheck?.recaptchaEnterpriseSiteKey) state.appCheck = initializeAppCheck(firebaseApp, { provider: new ReCaptchaEnterpriseProvider(state.config.appCheck.recaptchaEnterpriseSiteKey), isTokenAutoRefreshEnabled: true }); state.auth = getAuth(firebaseApp); await getRedirectResult(state.auth).catch(() => undefined); onAuthStateChanged(state.auth, async (user) => { if (!user) return signInScreen(); state.user = user; try { await api("/admin-api/v1/session"); loadView("overview"); } catch (error) { await signOut(state.auth).catch(() => undefined); signInScreen(error?.message || "This account is not an administrator."); } }); } catch (error) { signInScreen(error?.message || "The operations service is unavailable."); }
}
start();
