import { initializeApp } from "firebase/app";
import {
  getAuth, getRedirectResult, GoogleAuthProvider, OAuthProvider, onAuthStateChanged,
  signInWithPopup, signInWithRedirect, signOut
} from "firebase/auth";
import "./admin.css";

const appNode = document.querySelector("#app");
const previewHosts = new Set(["localhost", "127.0.0.1", "wl-purchase-entitlement.netlify.app"]);
let demo = previewHosts.has(location.hostname) && new URLSearchParams(location.search).get("demo") === "1";
const state = { auth: null, user: demo ? { email: "owner@wonderlang.net" } : null, config: { environment: demo ? "test" : "unknown", checkoutEnabled: false }, view: "overview", customer: null, previews: {}, notice: null };

const demoOverview = {
  metrics: { activeSubscriptions: 184, lifetimeCustomers: 327, graceSubscriptions: 6, failedOperations: 3 },
  alerts: [
    { tone: "danger", title: "2 delivery jobs need attention", detail: "Retries are paused in this test deployment", action: "Open operations" },
    { tone: "warning", title: "Japanese Steam inventory is low", detail: "8 keys available · threshold 10", action: "Review inventory" },
    { tone: "neutral", title: "6 subscriptions are in payment grace", detail: "Access remains available for up to seven days", action: "View customers" }
  ],
  activity: [
    { time: new Date().toISOString(), customer: "amina@example.com", event: "mobile_full_monthly", amount: null, state: "active" },
    { time: new Date(Date.now() - 900000).toISOString(), customer: "theo@example.com", event: "mobile_full_lifetime", amount: null, state: "active" }
  ]
};
const demoCustomer = {
  user: { uid: "demo_8a2f43", email: "amina@example.com", emailVerified: true, disabled: false, providers: ["google.com", "apple.com"], createdAt: "2026-02-14T10:00:00Z", lastSignInAt: new Date().toISOString() },
  entitlements: { accessKind: "subscription", products: ["mobile_full_monthly"], cloudSaveAllowed: true, subscriptionState: "active", validUntil: "2026-09-23T00:00:00Z" },
  grants: [{ id: "grant_demo", provider: "stripe", product: "mobile_full_monthly", state: "active", startsAt: "2026-08-01T00:00:00Z" }],
  legacyDiscount: null, stripeCustomerId: "cus_demo", cloudSaves: [{ id: "slot-1", updatedAt: new Date().toISOString() }],
  payments: [{ id: "pi_demo", amount: 699, amountReceived: 699, currency: "USD", status: "succeeded", createdAt: new Date().toISOString() }]
};
const demoCatalog = {
  revision: 3,
  monthly: { stripePriceId: "price_test_monthly", unitAmount: 699, currency: "USD", recurring: true },
  lifetime: { stripePriceId: "price_test_lifetime", unitAmount: 6000, currency: "USD", recurring: false },
  monthlyHistory: [], lifetimeHistory: [],
  notes: { priceChangesAffect: "new_checkouts_only", existingSubscriptions: "keep_their_existing_stripe_price", oldPrices: "retained_for_existing_subscriptions_and_webhook_history" }
};
const demoOperations = {
  providerEvents: [{ id: "evt_demo_failed", provider: "stripe", eventType: "invoice.payment_failed", status: "failed", receivedAt: new Date().toISOString(), lastError: "Demo delivery failure" }],
  outbox: [{ id: "job_demo_failed", kind: "meta_conversion", state: "failed", attemptCount: 6, createdAt: new Date().toISOString(), lastError: "Demo token rejected" }]
};
const demoInventory = { summary: [{ sheetTab: "Steam English", available: 42, assigned: 318 }, { sheetTab: "Steam Japanese", available: 8, assigned: 94 }, { sheetTab: "Itch English", available: 27, assigned: 71 }], recentFulfillments: [] };
const demoAudit = { entries: [{ id: "audit_demo", actorEmail: "owner@wonderlang.net", action: "catalog.price.change", targetType: "catalog", targetId: "monthly", summary: "Changed monthly price for new checkouts", createdAt: new Date().toISOString() }] };

const views = { overview: "Overview", customers: "Customers", billing: "Billing & prices", imports: "Imports", operations: "Operations", inventory: "Key inventory", audit: "Audit history", settings: "Settings" };
const endpoints = {
  overview: "/admin-api/v1/overview", billing: "/admin-api/v1/catalog", operations: "/admin-api/v1/operations",
  inventory: "/admin-api/v1/inventory", audit: "/admin-api/v1/audit", settings: "/admin-api/v1/session"
};

function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]); }
function initials(email = "WL") { return email.split("@")[0].split(/[._-]/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "WL"; }
function formatMoney(amount, currency = "USD") { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(amount || 0) / 100); }
function formatDate(value) { if (!value) return "—"; const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(value); }
function jsonCell(value) { return escapeHtml(typeof value === "string" ? value : JSON.stringify(value ?? "")); }
function navItem(id, number) { return `<button type="button" data-view="${id}" class="nav-item${state.view === id ? " selected" : ""}"><span>${number}</span>${views[id]}</button>`; }
function pageIntro(kicker, title, copy, actions = "") { return `<section class="page-intro"><div><p class="section-kicker">${kicker}</p><h2>${title}</h2><p>${copy}</p></div><div class="hero-actions">${actions}</div></section>`; }
function empty(message) { return `<div class="empty-state">${escapeHtml(message)}</div>`; }

function shell(content) {
  const environment = demo ? "Demo · test" : `${state.config.environment || "unknown"}${state.config.checkoutEnabled ? " · checkout on" : " · safe mode"}`;
  return `<div class="ops-shell"><aside class="side-nav">
    <div class="brand"><span class="brand-mark">W</span><span><strong>WonderLang</strong><small>Operations</small></span></div>
    <nav aria-label="Operations sections">${Object.keys(views).map((id, index) => navItem(id, String(index + 1).padStart(2, "0"))).join("")}</nav>
    <div class="side-foot"><span class="health-dot"></span><span><strong>${state.config.environment === "production" ? "Production" : "Test isolation"}</strong><small>Server-enforced controls</small></span></div>
  </aside><main class="workspace"><header class="topbar"><button class="mobile-menu" type="button" aria-label="Open navigation">Menu</button>
    <div><p class="eyebrow">CONTROL CENTRE</p><h1>${escapeHtml(views[state.view])}</h1></div>
    <div class="top-actions"><span class="environment"><i></i>${escapeHtml(environment)}</span><button class="user-menu" type="button" data-action="sign-out"><span>${initials(state.user?.email)}</span>${escapeHtml(state.user?.email)}</button></div>
  </header><div class="page-content">${content}</div></main></div><div id="toast" class="toast" role="status" aria-live="polite"></div>`;
}

function metric(label, value, note, tone) { return `<article class="metric-card ${tone}"><p>${label}</p><strong>${Number(value || 0).toLocaleString()}</strong><span>${note}</span></article>`; }
function renderOverview(data) {
  const m = data.metrics || {};
  return `${pageIntro("TODAY AT A GLANCE", "Your business, in one view.", "Purchases, access, delivery health and anything that needs intervention.", '<button class="button secondary" data-view="customers">Find a customer</button><button class="button primary" data-view="imports">Import customers</button>')}
  <section class="metric-grid">${metric("Active monthly", m.activeSubscriptions, "All chapters and languages", "accent")}${metric("Lifetime access", m.lifetimeCustomers, "Permanent mobile access", "dark")}${metric("Payment grace", m.graceSubscriptions, "Seven-day access window", "warning")}${metric("Needs attention", m.failedOperations, "Manual review queue", "danger")}</section>
  <section class="dashboard-grid"><article class="panel attention-panel"><header><div><p class="section-kicker">ATTENTION QUEUE</p><h3>What needs you</h3></div><button class="text-button" data-view="operations">See all</button></header><div class="alert-list">${(data.alerts || []).length ? data.alerts.map((a) => `<button class="alert-row" data-view="${a.tone === "warning" ? "inventory" : "operations"}"><span class="alert-icon ${escapeHtml(a.tone)}"></span><span><strong>${escapeHtml(a.title)}</strong><small>${escapeHtml(a.detail)}</small></span><b>${escapeHtml(a.action)} →</b></button>`).join("") : empty("Nothing needs attention.")}</div></article>
  <article class="panel quick-panel"><header><div><p class="section-kicker">SAFE SHORTCUTS</p><h3>Quick actions</h3></div></header><div class="quick-grid">${[["Customer lookup", "Search access, purchases and saves", "customers"], ["Change a price", "New checkouts only", "billing"], ["Issue a refund", "Preview before money moves", "billing"], ["Import purchases", "Dry-run before applying", "imports"]].map(([t,d,v]) => `<button class="quick-action" data-view="${v}"><span>↗</span><strong>${t}</strong><small>${d}</small></button>`).join("")}</div></article></section>
  <section class="panel activity-panel"><header><div><p class="section-kicker">LIVE LEDGER</p><h3>Recent entitlement activity</h3></div></header>${table(["When", "Customer", "Event", "Value", "Status"], (data.activity || []).map((r) => [formatDate(r.time), r.customer, r.event, r.amount ? formatMoney(r.amount, r.currency) : "—", `<span class="state-pill">${escapeHtml(r.state)}</span>`]))}</section>`;
}

function renderCustomers() {
  const c = state.customer;
  const detail = c ? `<section class="customer-grid"><article class="panel detail-card"><header><div><p class="section-kicker">ACCOUNT</p><h3>${escapeHtml(c.user.email || c.user.uid)}</h3></div><span class="state-pill">${c.user.disabled ? "Disabled" : "Enabled"}</span></header><dl class="definition-grid"><div><dt>Firebase UID</dt><dd>${escapeHtml(c.user.uid)}</dd></div><div><dt>Providers</dt><dd>${escapeHtml((c.user.providers || []).join(", ") || "None")}</dd></div><div><dt>Email verified</dt><dd>${c.user.emailVerified ? "Yes" : "No"}</dd></div><div><dt>Last sign-in</dt><dd>${formatDate(c.user.lastSignInAt)}</dd></div></dl><div class="card-actions"><button class="button secondary" data-customer-action="sessions">Revoke sessions</button><button class="button danger" data-customer-action="access">${c.user.disabled ? "Enable account" : "Disable account"}</button></div></article>
    <article class="panel detail-card"><header><div><p class="section-kicker">EFFECTIVE ACCESS</p><h3>${escapeHtml(c.entitlements.accessKind || "None")}</h3></div></header><dl class="definition-grid"><div><dt>Products</dt><dd>${escapeHtml((c.entitlements.products || []).join(", ") || "None")}</dd></div><div><dt>Subscription</dt><dd>${escapeHtml(c.entitlements.subscriptionState || "—")}</dd></div><div><dt>Cloud saves</dt><dd>${c.entitlements.cloudSave || c.entitlements.cloudSaveAllowed ? "Allowed" : "Not allowed"}</dd></div><div><dt>Valid until</dt><dd>${formatDate(c.entitlements.validUntil)}</dd></div></dl></article></section>
    <section class="split-grid"><article class="panel form-panel"><header><div><p class="section-kicker">MANUAL ACCESS</p><h3>Grant an entitlement</h3></div></header><form id="grant-form" class="stack-form"><label>Product<select name="product"><option value="mobile_full_lifetime">Mobile lifetime</option><option value="legacy_mobile_full">Legacy mobile full</option><option value="legacy_chapter_1">Legacy chapter 1</option><option value="legacy_chapter_2">Legacy chapter 2</option><option value="legacy_chapter_3">Legacy chapter 3</option><option value="legacy_chapter_4">Legacy chapter 4</option></select></label><label>Optional expiry<input type="datetime-local" name="endsAt"></label><label>Audit reason<textarea name="reason" minlength="10" required placeholder="Why is this grant authorized?"></textarea></label><button class="button primary">Grant access</button></form></article>
    <article class="panel"><header><div><p class="section-kicker">GRANTS</p><h3>Access ledger</h3></div></header>${table(["Product", "Source", "State", "Started", "Action"], (c.grants || []).map((g) => [g.product, g.provider, g.state, formatDate(g.startsAt), g.provider === "admin" && g.state === "active" ? `<button class="text-button" data-revoke-grant="${escapeHtml(g.id)}">Revoke</button>` : "—"]))}</article></section>
    <section class="panel"><header><div><p class="section-kicker">STRIPE PAYMENTS</p><h3>Payments and refunds</h3></div></header>${table(["Created", "Payment", "Amount", "Status", "Action"], (c.payments || []).map((p) => [formatDate(p.createdAt), p.id, formatMoney(p.amountReceived || p.amount, p.currency), p.status, `<button class="text-button" data-refund="${escapeHtml(p.id)}" data-amount="${Number(p.amountReceived || p.amount)}" data-currency="${escapeHtml(p.currency)}">Refund</button>`]))}</section>` : empty("Search an exact email address or Firebase UID to inspect an account.");
  return `${pageIntro("CUSTOMER SUPPORT", "Find the whole customer story.", "Access, purchases, login providers, cloud saves and manual actions are tied to one Firebase UID.")}
  <form id="customer-search" class="search-bar"><input name="q" type="search" required placeholder="Exact email or Firebase UID" value="${escapeHtml(c?.user?.email || "")}"><button class="button primary">Search</button></form>${detail}`;
}

function renderBilling(data) {
  const cards = ["monthly", "lifetime"].map((kind) => { const offer = data[kind]; return `<article class="price-card"><p>${kind === "monthly" ? "MONTHLY SUBSCRIPTION" : "LIFETIME ACCESS"}</p><strong>${formatMoney(offer.unitAmount, offer.currency)}</strong><span>${kind === "monthly" ? "per month" : "one time"}</span><small>${escapeHtml(offer.stripePriceId)}</small></article>`; }).join("");
  return `${pageIntro("BILLING CONTROL", "Prices change safely.", "A price change creates a new immutable Stripe Price for future checkouts. Existing subscriptions keep their old price.")}
  <section class="price-grid">${cards}</section><section class="split-grid"><article class="panel form-panel"><header><div><p class="section-kicker">PRICE CHANGE</p><h3>Preview a new price</h3></div></header><form id="price-form" class="stack-form"><label>Offer<select name="kind"><option value="monthly">Monthly subscription</option><option value="lifetime">Lifetime access</option></select></label><div class="field-row"><label>Amount<input name="amount" inputmode="decimal" required placeholder="6.99"></label><label>Currency<input name="currency" value="USD" maxlength="3" required></label></div><button class="button primary">Preview change</button></form><div id="price-preview"></div></article>
  <article class="panel policy-card"><header><div><p class="section-kicker">POLICY</p><h3>What changes—and what does not</h3></div></header><ul class="policy-list"><li>Only new checkouts use the new price.</li><li>Old Stripe Prices remain available for webhook history.</li><li>Existing subscribers are never silently migrated.</li><li>A second typed confirmation is required.</li><li>Test deployments refuse every live Stripe key.</li></ul></article></section>`;
}

function renderImports() {
  return `${pageIntro("CUSTOMER MIGRATION", "Import without surprises.", "Paste CSV or choose a file, validate every row, then type a confirmation before anything is applied.", '<button class="button secondary" data-action="download-template">Download template</button>')}
  <section class="panel form-panel"><header><div><p class="section-kicker">CSV DRY RUN</p><h3>Purchase and entitlement import</h3></div><span class="state-pill">Maximum 500 rows</span></header><form id="import-form" class="stack-form"><label>CSV file<input id="import-file" type="file" accept=".csv,text/csv"></label><label>CSV rows<textarea name="csv" class="code-input" rows="12" required placeholder="email,kind,externalId,startsAt,endsAt,note&#10;person@example.com,mobile_lifetime,order_123,,,Historical mobile purchase"></textarea></label><button class="button primary">Validate import</button></form><div id="import-preview"></div></section>
  <section class="panel info-strip"><strong>Unknown email?</strong><p>The record waits for that exact verified email to sign in with Google or Apple. The importer never creates insecure placeholder accounts.</p></section>`;
}

function renderOperations(data) {
  const outbox = (data.outbox || []).map((j) => [formatDate(j.createdAt), j.kind, j.state, j.attemptCount ?? 0, jsonCell(j.lastError), j.state === "failed" ? `<button class="text-button" data-retry-job="${escapeHtml(j.id)}">Retry</button>` : "—"]);
  const events = (data.providerEvents || []).map((e) => [formatDate(e.receivedAt), e.provider, e.eventType, e.status, jsonCell(e.lastError), e.status === "failed" ? `<button class="text-button" data-release-event="${escapeHtml(e.id)}">Release</button>` : "—"]);
  return `${pageIntro("DELIVERY CONTROL", "Every side effect is traceable.", "Webhook ingestion and asynchronous work are idempotent. Only terminal failures can be manually retried.")}
  <section class="panel"><header><div><p class="section-kicker">OUTBOX</p><h3>Queued operations</h3></div></header>${table(["Created", "Kind", "State", "Attempts", "Last error", "Action"], outbox)}</section>
  <section class="panel spaced"><header><div><p class="section-kicker">PROVIDER EVENTS</p><h3>Webhook ledger</h3></div></header>${table(["Received", "Provider", "Type", "Status", "Last error", "Action"], events)}</section>`;
}

function renderInventory(data) {
  return `${pageIntro("KEY INVENTORY", "Know before stock runs out.", "Steam and Itch keys remain separate from mobile entitlements. Low stock is highlighted at ten keys or fewer.")}
  <section class="inventory-grid">${(data.summary || []).map((r) => `<article class="inventory-card ${r.available <= 10 ? "low" : ""}"><p>${escapeHtml(r.sheetTab)}</p><strong>${Number(r.available).toLocaleString()}</strong><span>available</span><small>${Number(r.assigned).toLocaleString()} assigned</small></article>`).join("")}</section>
  <section class="panel"><header><div><p class="section-kicker">RECENT FULFILLMENT</p><h3>Delivered key orders</h3></div></header>${(data.recentFulfillments || []).length ? table(["When", "Order", "Keys"], data.recentFulfillments.map((r) => [formatDate(r.createdAt), r.orderId, (r.keys || []).length])) : empty("No fulfillment records in this environment.")}</section>`;
}

function renderAudit(data) {
  return `${pageIntro("ADMIN AUDIT", "A record of every sensitive action.", "Price changes, refunds, imports, grants, account controls and retries include the acting administrator and reason.")}
  <section class="panel"><header><div><p class="section-kicker">IMMUTABLE HISTORY</p><h3>Latest actions</h3></div></header>${table(["When", "Administrator", "Action", "Target", "Summary"], (data.entries || []).map((e) => [formatDate(e.createdAt), e.actorEmail, e.action, `${e.targetType}:${e.targetId}`, e.summary]))}</section>`;
}

function renderSettings(data) {
  const switches = ["Stripe webhooks", "Google Play webhooks", "Apple webhooks", "Outbox worker", "Ad conversions", "Legacy fulfillment"];
  return `${pageIntro("SECURITY & SETUP", "Test mode is enforced by the server.", "The visible label is informational; secret-key mode and administrator claims are validated on every protected request.")}
  <section class="settings-grid"><article class="panel detail-card"><header><div><p class="section-kicker">ADMIN SESSION</p><h3>${escapeHtml(data.actor?.email || state.user?.email)}</h3></div></header><dl class="definition-grid"><div><dt>Firebase UID</dt><dd>${escapeHtml(data.actor?.uid || "Demo")}</dd></div><div><dt>Signed in through</dt><dd>${escapeHtml((data.providers || ["demo"]).join(", "))}</dd></div><div><dt>Authorization</dt><dd>Server-verified admin claim</dd></div><div><dt>Capabilities</dt><dd>${escapeHtml((data.capabilities || []).join(", "))}</dd></div></dl></article>
  <article class="panel"><header><div><p class="section-kicker">DEPLOYMENT GUARDS</p><h3>${escapeHtml(state.config.environment || "Unknown")} environment</h3></div></header><div class="guard-list">${switches.map((s) => `<div><span>${s}</span><b>Configured in Netlify</b></div>`).join("")}</div></article></section>
  <section class="panel spaced"><header><div><p class="section-kicker">SSO READINESS</p><h3>Google and Apple</h3></div></header><ul class="policy-list"><li>Both providers use Firebase Authentication.</li><li>Signing in never grants admin access by itself.</li><li>Google and Apple identities merge only through verified account-linking rules.</li><li>The Netlify domain must be authorized in Firebase and Apple Services ID settings.</li></ul></section>`;
}

function table(headers, rows) { if (!rows.length) return empty("No records in this environment."); return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${String(cell).startsWith("<") ? cell : escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`; }
function toast(message, error = false) { const node = document.querySelector("#toast"); if (!node) return; node.textContent = message; node.className = `toast show${error ? " error" : ""}`; setTimeout(() => node.classList.remove("show"), 4500); }

async function api(path, options = {}) {
  if (demo) return demoApi(path, options);
  const token = await state.auth.currentUser.getIdToken(true);
  const response = await fetch(path, { method: options.method || "GET", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}
function demoApi(path, options) {
  if (path.includes("overview")) return demoOverview;
  if (path.includes("customers")) return demoCustomer;
  if (path.endsWith("/catalog")) return demoCatalog;
  if (path.includes("operations")) return demoOperations;
  if (path.includes("inventory")) return demoInventory;
  if (path.includes("audit")) return demoAudit;
  if (path.includes("session")) return { actor: { uid: "demo_admin", email: state.user.email }, providers: ["google.com"], capabilities: Object.keys(views) };
  if (path.includes("price-preview")) return { previewId: crypto.randomUUID(), confirmationPhrase: "CHANGE MONTHLY TO 7.99 USD", warning: "Existing subscribers keep their current price." };
  if (path.includes("refunds/preview")) return { previewId: crypto.randomUUID(), confirmationPhrase: "REFUND 6.99 USD", warnings: ["A refund does not cancel an active subscription."] };
  if (path.includes("imports/preview")) return { previewId: crypto.randomUUID(), confirmationPhrase: "IMPORT 1 RECORD", summary: { records: 1, existingAccounts: 0, pendingFirstSignIn: 1, entitlements: 1, discounts: 0 }, rows: options.body?.rows || [], warnings: ["Unknown emails wait for verified first sign-in."] };
  return { ok: true };
}

async function loadView(view) {
  state.view = view;
  appNode.innerHTML = shell(`<div class="loading">Loading ${escapeHtml(views[view])}…</div>`);
  bindShell();
  try {
    let data;
    if (view === "overview") data = await api(endpoints.overview);
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
  document.querySelector("#customer-search")?.addEventListener("submit", async (event) => { event.preventDefault(); const q = new FormData(event.currentTarget).get("q"); try { state.customer = await api(`/admin-api/v1/customers/search?q=${encodeURIComponent(q)}`); await loadView("customers"); } catch (error) { toast(error.message, true); } });
  document.querySelector("#grant-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const f = new FormData(event.currentTarget); const body = { product: f.get("product"), reason: f.get("reason"), ...(f.get("endsAt") ? { endsAt: new Date(f.get("endsAt")).toISOString() } : {}) }; if (await mutate(`/admin-api/v1/customers/${state.customer.user.uid}/grants`, body, "Access granted.")) { state.customer = await api(`/admin-api/v1/customers/${state.customer.user.uid}`); loadView("customers"); } });
  document.querySelectorAll("[data-revoke-grant]").forEach((b) => b.addEventListener("click", async () => { const r = await reason("Why are you revoking this manual grant?"); if (r && await mutate(`/admin-api/v1/grants/${b.dataset.revokeGrant}/revoke`, { reason: r }, "Grant revoked.")) { state.customer = await api(`/admin-api/v1/customers/${state.customer.user.uid}`); loadView("customers"); } }));
  document.querySelectorAll("[data-customer-action]").forEach((b) => b.addEventListener("click", async () => { const r = await reason(b.dataset.customerAction === "sessions" ? "Why are you revoking all sessions?" : `Why are you ${state.customer.user.disabled ? "enabling" : "disabling"} this account?`); if (!r) return; const path = b.dataset.customerAction === "sessions" ? "revoke-sessions" : "access"; const body = b.dataset.customerAction === "sessions" ? { reason: r } : { reason: r, disabled: !state.customer.user.disabled }; if (await mutate(`/admin-api/v1/customers/${state.customer.user.uid}/${path}`, body, "Account security updated.")) { state.customer = await api(`/admin-api/v1/customers/${state.customer.user.uid}`); loadView("customers"); } }));
  document.querySelectorAll("[data-refund]").forEach((b) => b.addEventListener("click", () => refundFlow(b)));
  document.querySelector("#price-form")?.addEventListener("submit", priceFlow);
  document.querySelector("#import-form")?.addEventListener("submit", importFlow);
  document.querySelector("#import-file")?.addEventListener("change", async (event) => { const file = event.target.files?.[0]; if (file) document.querySelector('[name="csv"]').value = await file.text(); });
  document.querySelector('[data-action="download-template"]')?.addEventListener("click", downloadTemplate);
  document.querySelectorAll("[data-retry-job]").forEach((b) => b.addEventListener("click", async () => { const r = await reason("Why should this terminal job be retried?"); if (r && await mutate(`/admin-api/v1/outbox/${b.dataset.retryJob}/retry`, { reason: r }, "Job queued for retry.")) loadView("operations"); }));
  document.querySelectorAll("[data-release-event]").forEach((b) => b.addEventListener("click", async () => { const r = await reason("Why should this event be released for provider redelivery?"); if (r && await mutate(`/admin-api/v1/provider-events/${b.dataset.releaseEvent}/release`, { reason: r }, "Event released.")) loadView("operations"); }));
}

async function priceFlow(event) {
  event.preventDefault(); const f = new FormData(event.currentTarget); const amount = Math.round(Number(f.get("amount")) * 100);
  try { const p = await api("/admin-api/v1/catalog/price-preview", { method: "POST", body: { kind: f.get("kind"), unitAmount: amount, currency: String(f.get("currency")).toUpperCase() } }); state.previews.price = p; document.querySelector("#price-preview").innerHTML = confirmPanel("Price preview", p.warning, p.confirmationPhrase, "confirm-price"); document.querySelector("#confirm-price").addEventListener("submit", async (e) => { e.preventDefault(); const phrase = new FormData(e.currentTarget).get("phrase"); if (await mutate("/admin-api/v1/catalog/price-commit", { previewId: p.previewId, confirmationPhrase: phrase }, "Price changed for new checkouts.")) loadView("billing"); }); } catch (error) { toast(error.message, true); }
}
async function refundFlow(button) {
  const currency = escapeHtml(button.dataset.currency || "USD");
  const maximum = (Number(button.dataset.amount) / 100).toFixed(2);
  const data = await formDialog({
    title: "Prepare a Stripe refund",
    copy: `Review the amount and reason. The maximum shown is ${maximum} ${button.dataset.currency || "USD"}; leave amount blank to refund all remaining funds.`,
    fields: `<label>Amount (${currency})<input name="amount" type="number" inputmode="decimal" min="0.01" max="${maximum}" step="0.01" placeholder="All remaining funds"></label>
      <label>Stripe reason<select name="reason"><option value="requested_by_customer">Requested by customer</option><option value="duplicate">Duplicate</option><option value="fraudulent">Fraudulent</option></select></label>
      <label>Audit note<textarea name="note" minlength="10" maxlength="500" required placeholder="Explain why this refund is authorized."></textarea></label>`,
    confirmText: "Preview refund",
    danger: true
  });
  if (!data) return;
  const amountText = String(data.get("amount") || "").trim();
  const note = String(data.get("note") || "").trim();
  const refundReason = String(data.get("reason") || "requested_by_customer");
  try { const p = await api("/admin-api/v1/refunds/preview", { method: "POST", body: { uid: state.customer.user.uid, paymentIntentId: button.dataset.refund, ...(amountText ? { amount: Math.round(Number(amountText) * 100) } : {}), reason: refundReason, note } }); const holder = document.createElement("div"); holder.className = "modal-backdrop"; holder.innerHTML = `<div class="confirm-modal">${confirmPanel("Refund preview", (p.warnings || []).join(" "), p.confirmationPhrase, "confirm-refund")}<button class="button secondary" data-close>Cancel</button></div>`; document.body.append(holder); holder.querySelector("[data-close]").addEventListener("click", () => holder.remove()); holder.querySelector("#confirm-refund").addEventListener("submit", async (e) => { e.preventDefault(); const phrase = new FormData(e.currentTarget).get("phrase"); if (await mutate("/admin-api/v1/refunds/commit", { previewId: p.previewId, confirmationPhrase: phrase }, "Refund submitted to Stripe.")) { holder.remove(); state.customer = await api(`/admin-api/v1/customers/${state.customer.user.uid}`); loadView("customers"); } }); } catch (error) { toast(error.message, true); }
}
function confirmPanel(title, warning, phrase, id) { return `<div class="confirmation"><h4>${escapeHtml(title)}</h4><p>${escapeHtml(warning)}</p><code>${escapeHtml(phrase)}</code><form id="${id}" class="stack-form"><label>Type the phrase exactly<input name="phrase" required autocomplete="off"></label><button class="button danger">Confirm action</button></form></div>`; }
function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim()); if (lines.length < 2) throw new Error("CSV needs a header and at least one data row.");
  const cells = (line) => { const out = []; let value = "", quoted = false; for (let i = 0; i < line.length; i += 1) { const c = line[i]; if (c === '"' && quoted && line[i + 1] === '"') { value += '"'; i += 1; } else if (c === '"') quoted = !quoted; else if (c === "," && !quoted) { out.push(value.trim()); value = ""; } else value += c; } out.push(value.trim()); return out; };
  const headers = cells(lines[0]); const required = ["email", "kind", "externalId", "startsAt", "endsAt", "note"]; if (required.some((h) => !headers.includes(h))) throw new Error(`CSV header must include: ${required.join(", ")}.`);
  return lines.slice(1).map((line) => { const values = cells(line); return Object.fromEntries(headers.map((h, i) => [h, values[i] || undefined])); }).map((r) => ({ email: r.email, kind: r.kind, externalId: r.externalId, note: r.note, ...(r.startsAt ? { startsAt: new Date(r.startsAt).toISOString() } : {}), ...(r.endsAt ? { endsAt: new Date(r.endsAt).toISOString() } : {}) }));
}
async function importFlow(event) {
  event.preventDefault(); try { const rows = parseCsv(new FormData(event.currentTarget).get("csv")); const p = await api("/admin-api/v1/imports/preview", { method: "POST", body: { rows } }); state.previews.import = p; document.querySelector("#import-preview").innerHTML = `<div class="preview-summary">${Object.entries(p.summary).map(([k,v]) => `<div><span>${escapeHtml(k)}</span><strong>${Number(v)}</strong></div>`).join("")}</div>${confirmPanel("Import is ready", (p.warnings || []).join(" "), p.confirmationPhrase, "confirm-import")}`; document.querySelector("#confirm-import").addEventListener("submit", async (e) => { e.preventDefault(); const phrase = new FormData(e.currentTarget).get("phrase"); if (await mutate("/admin-api/v1/imports/commit", { previewId: p.previewId, confirmationPhrase: phrase }, "Import completed.")) loadView("imports"); }); } catch (error) { toast(error.message, true); }
}
function downloadTemplate() { const csv = "email,kind,externalId,startsAt,endsAt,note\nperson@example.com,mobile_lifetime,order_123,,,Historical mobile purchase\n"; const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); const a = document.createElement("a"); a.href = url; a.download = "wonderlang-import-template.csv"; a.click(); URL.revokeObjectURL(url); }

function signInScreen(message = "Sign in with an approved WonderLang administrator account.") {
  appNode.innerHTML = `<main class="sign-in-page"><section class="sign-in-card"><span class="brand-mark large">W</span><p class="eyebrow">WONDERLANG OPERATIONS</p><h1>Run the business<br>without the busywork.</h1><p>${escapeHtml(message)}</p><div class="sign-in-actions"><button data-provider="google">Continue with Google</button><button class="apple" data-provider="apple">Continue with Apple</button></div><small>Access requires a server-verified Firebase administrator claim. Signing in alone never grants access.</small></section></main>`;
  document.querySelector('[data-provider="google"]')?.addEventListener("click", () => providerSignIn(new GoogleAuthProvider()));
  document.querySelector('[data-provider="apple"]')?.addEventListener("click", () => { const provider = new OAuthProvider("apple.com"); provider.addScope("email"); provider.addScope("name"); providerSignIn(provider); });
}
async function providerSignIn(provider) { try { await signInWithPopup(state.auth, provider); } catch (error) { if (["auth/popup-blocked", "auth/cancelled-popup-request", "auth/operation-not-supported-in-this-environment"].includes(error?.code)) return signInWithRedirect(state.auth, provider); signInScreen(error?.message || "Sign-in failed."); } }
async function start() {
  if (demo) return loadView("overview"); signInScreen("Loading secure sign-in…");
  try { const response = await fetch("/api/v1/config"); if (!response.ok) throw new Error("The account service is not configured yet."); state.config = await response.json(); state.auth = getAuth(initializeApp(state.config.firebase)); await getRedirectResult(state.auth).catch(() => undefined); onAuthStateChanged(state.auth, async (user) => { if (!user) return signInScreen(); state.user = user; try { await api("/admin-api/v1/session"); loadView("overview"); } catch (error) { await signOut(state.auth).catch(() => undefined); signInScreen(error?.message || "This account is not an administrator."); } }); } catch (error) {
    if (previewHosts.has(location.hostname)) {
      demo = true;
      state.user = { email: "owner@wonderlang.net" };
      state.config = { environment: "test", checkoutEnabled: false };
      return loadView("overview");
    }
    signInScreen(error?.message || "The operations service is unavailable.");
  }
}
start();
