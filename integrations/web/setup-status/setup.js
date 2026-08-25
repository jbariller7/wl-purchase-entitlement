import "./setup.css";

const root = document.querySelector("#setup-app");
const demo = ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).get("demo") === "1";
const configLabels = {
  firebaseAdmin: ["Firebase server", "Service account for entitlements and admin APIs"],
  firebaseWeb: ["Firebase web login", "Browser configuration for enabled Firebase sign-in methods"],
  stripeTest: ["Stripe test mode", "Test secret, Prices, Coupon and webhook secret"],
  legacyFulfillment: ["Sheets & MailerLite", "Legacy key delivery credentials (kept disabled initially)"],
  adDelivery: ["Ad test delivery", "Meta and TikTok credentials (not needed for account tests)"],
  googlePlay: ["Google Play sandbox", "Developer API and authenticated RTDN"],
  appleStore: ["App Store sandbox", "Server API, notification certificates and IDs"],
  providerTokenEncryption: ["Provider token vault", "Netlify-only AES-256-GCM key ring for Play subscription recovery"]
};
const controlLabels = {
  STRIPE_WEBHOOKS_ENABLED: "Stripe webhooks",
  GOOGLE_PLAY_WEBHOOKS_ENABLED: "Google Play webhooks",
  APPLE_WEBHOOKS_ENABLED: "Apple webhooks",
  OUTBOX_PROCESSING_ENABLED: "Async worker",
  AD_CONVERSIONS_ENABLED: "Ad conversions",
  LEGACY_FULFILLMENT_ENABLED: "Legacy fulfillment",
  SUBSCRIPTION_CANCELLATION_ENABLED: "Subscription cancellation",
  ACCOUNT_DELETION_PROCESSING_ENABLED: "Account deletion purge",
  STRIPE_MUTATIONS_ENABLED: "Stripe mutations",
  APP_CHECK_ENFORCEMENT_ENABLED: "Firebase App Check enforcement",
  SUBSCRIPTION_RECONCILIATION_ENABLED: "Daily subscription reconciliation",
  CLOUD_STORAGE_MONITORING_ENABLED: "Cloud storage monitoring",
  CLOUD_SAVE_CLEANUP_ENABLED: "Cloud-save revision cleanup",
  DEVICE_SIGN_IN_ENABLED: "PC/Mac device sign-in",
  DEVICE_SIGN_IN_CLEANUP_ENABLED: "Expired device-code cleanup",
  ADMIN_BOOTSTRAP_ENABLED: "Initial admin bootstrap"
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function render(data) {
  const configured = Object.values(data.configuration).filter(Boolean).length;
  const total = Object.keys(data.configuration).length;
  const accountReady = data.readiness?.accountTesting ?? ["ready_for_account_testing", "ready_for_stripe_canary", "ready_for_checkout_testing"].includes(data.status);
  const stripeConfigured = data.readiness?.stripeConfigured ?? Boolean(data.configuration?.stripeTest);
  const checkoutReady = data.readiness?.checkoutTesting ?? data.status === "ready_for_checkout_testing";
  const headline = checkoutReady
    ? "The controlled Stripe checkout canary is enabled."
    : stripeConfigured
      ? "Account and Stripe configuration are ready. Checkout remains safely off."
      : accountReady
      ? "Account testing ready. Checkout waiting for Stripe."
      : "Safe, waiting for Firebase test credentials.";
  const nextGate = checkoutReady
    ? "Exercise login, administration and Stripe test purchases"
    : stripeConfigured
      ? "Enable and run one controlled Stripe canary"
      : accountReady
      ? "Create the first administrator, then connect Stripe test mode"
      : "Finish isolated Firebase account configuration";
  const nextSteps = checkoutReady
    ? `<li>Use only Stripe test-mode payment data.</li><li>Complete one Premium Checkout and verify exactly one signed webhook event reaches the entitlement ledger.</li><li>Exercise Portal, refund and dispute handling, then turn both Stripe switches off again.</li><li>Keep fulfillment, advertising and every unrelated provider switch off throughout the canary.</li>`
    : stripeConfigured
      ? `<li>Grant one verified account through the audited administrator bootstrap, then disable bootstrap immediately.</li><li>Confirm the restricted Stripe catalog with a read-only diagnostic.</li><li>Enable only <code>STRIPE_MUTATIONS_ENABLED</code> and <code>STRIPE_WEBHOOKS_ENABLED</code> for the controlled test-mode canary.</li><li>Do not treat configuration readiness as evidence that a payment has been processed.</li>`
      : accountReady
        ? `<li>Complete one real Google login.</li><li>Grant that verified account through the audited one-time administrator bootstrap, then disable bootstrap immediately.</li><li>Add a least-privilege Stripe <code>rk_test_</code> key and test webhook credentials; checkout remains disabled until then.</li><li>Enable and test one isolated provider workflow at a time; keep production processing off.</li>`
    : `<li>Install the Firebase web and Admin configuration for <code>wonderlang-accounts</code>.</li><li>Verify Google and passwordless-email login without enabling payments.</li><li>Grant the verified owner through the audited administrator bootstrap.</li><li>Connect Stripe test mode only after account testing passes.</li>`;
  root.innerHTML = `<main class="setup-shell">
    <header class="setup-header"><a class="brand" href="/"><span>W</span><strong>WonderLang</strong></a><nav><a href="/account/">Account</a><a href="/admin/">Operations</a></nav></header>
    <section class="setup-hero"><div><p class="eyebrow">DEPLOYMENT STATUS</p><h1>${headline}</h1><p>This page contains readiness booleans only. It never returns or reads secret values in the browser.</p></div><div class="mode-card ${data.safeMode ? "safe" : "active"}"><span>${data.safeMode ? "SAFE MODE" : "TESTING ACTIVE"}</span><strong>${escapeHtml(data.environment)}</strong><small>${data.safeMode ? "All side effects are disabled" : "One or more test workflows are enabled"}</small></div></section>
    <section class="progress-panel"><div><span>Configuration readiness</span><strong>${configured} / ${total}</strong></div><progress max="${total}" value="${configured}"></progress></section>
    <section class="content-grid"><article class="panel"><header><p class="eyebrow">CONNECTIONS</p><h2>Provider readiness</h2></header><div class="status-list">${Object.entries(configLabels).map(([key, [title, copy]]) => `<div><i class="${data.configuration[key] ? "ready" : "waiting"}"></i><span><strong>${title}</strong><small>${copy}</small></span><b>${data.configuration[key] ? "Ready" : "Required"}</b></div>`).join("")}</div></article>
    <article class="panel"><header><p class="eyebrow">KILL SWITCHES</p><h2>Side-effect controls</h2></header><div class="status-list controls">${Object.entries(controlLabels).map(([key, title]) => `<div><i class="${data.controls[key] ? "enabled" : "waiting"}"></i><span><strong>${title}</strong><small>${data.controls[key] ? "Enabled intentionally" : "Off"}</small></span><b>${data.controls[key] ? "On" : "Off"}</b></div>`).join("")}</div></article></section>
    <section class="panel next"><header><p class="eyebrow">NEXT GATE</p><h2>${nextGate}</h2></header><ol>${nextSteps}</ol><div class="actions"><button id="refresh" type="button">Refresh status</button><a href="/admin/">Open operations console</a></div></section>
    <footer>Deploy ${escapeHtml(data.deploy || "pending commit metadata")} · Auto-refreshes every 15 seconds</footer>
  </main>`;
  document.querySelector("#refresh")?.addEventListener("click", load);
}

async function load() {
  if (demo) {
    render({
      status: "configuration_required", environment: "test", safeMode: true, deploy: "local-preview",
      readiness: { accountTesting: false, stripeConfigured: false, checkoutTesting: false },
      configuration: { firebaseAdmin: false, firebaseWeb: false, stripeTest: false, legacyFulfillment: false, adDelivery: false, googlePlay: false, appleStore: false, providerTokenEncryption: false },
      controls: Object.fromEntries(Object.keys(controlLabels).map((key) => [key, false]))
    });
    return;
  }
  try {
    const response = await fetch("/healthz", { cache: "no-store" });
    if (!response.ok) throw new Error(`Health request failed (${response.status})`);
    render(await response.json());
  } catch (error) {
    root.innerHTML = `<main class="setup-shell"><section class="failure"><h1>Status unavailable</h1><p>${escapeHtml(error.message)}</p><button id="refresh">Try again</button></section></main>`;
    document.querySelector("#refresh")?.addEventListener("click", load);
  }
}

load();
setInterval(load, 15_000);
