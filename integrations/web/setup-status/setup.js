import "./setup.css";

const root = document.querySelector("#setup-app");
const demo = ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).get("demo") === "1";
const configLabels = {
  firebaseAdmin: ["Firebase server", "Service account for entitlements and admin APIs"],
  firebaseWeb: ["Firebase web login", "Public configuration for Google and Apple sign-in"],
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
  DEVICE_SIGN_IN_ENABLED: "PC/Mac device sign-in",
  DEVICE_SIGN_IN_CLEANUP_ENABLED: "Expired device-code cleanup"
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function render(data) {
  const configured = Object.values(data.configuration).filter(Boolean).length;
  const total = Object.keys(data.configuration).length;
  const ready = data.status === "ready_for_account_testing";
  root.innerHTML = `<main class="setup-shell">
    <header class="setup-header"><a class="brand" href="/"><span>W</span><strong>WonderLang</strong></a><nav><a href="/account/">Account</a><a href="/admin/">Operations</a></nav></header>
    <section class="setup-hero"><div><p class="eyebrow">DEPLOYMENT STATUS</p><h1>${ready ? "Ready for account testing." : "Safe, waiting for test credentials."}</h1><p>This page contains readiness booleans only. It never returns or reads secret values in the browser.</p></div><div class="mode-card ${data.safeMode ? "safe" : "active"}"><span>${data.safeMode ? "SAFE MODE" : "TESTING ACTIVE"}</span><strong>${escapeHtml(data.environment)}</strong><small>${data.safeMode ? "All side effects are disabled" : "One or more test workflows are enabled"}</small></div></section>
    <section class="progress-panel"><div><span>Configuration readiness</span><strong>${configured} / ${total}</strong></div><progress max="${total}" value="${configured}"></progress></section>
    <section class="content-grid"><article class="panel"><header><p class="eyebrow">CONNECTIONS</p><h2>Provider readiness</h2></header><div class="status-list">${Object.entries(configLabels).map(([key, [title, copy]]) => `<div><i class="${data.configuration[key] ? "ready" : "waiting"}"></i><span><strong>${title}</strong><small>${copy}</small></span><b>${data.configuration[key] ? "Ready" : "Required"}</b></div>`).join("")}</div></article>
    <article class="panel"><header><p class="eyebrow">KILL SWITCHES</p><h2>Side-effect controls</h2></header><div class="status-list controls">${Object.entries(controlLabels).map(([key, title]) => `<div><i class="${data.controls[key] ? "enabled" : "waiting"}"></i><span><strong>${title}</strong><small>${data.controls[key] ? "Enabled intentionally" : "Off"}</small></span><b>${data.controls[key] ? "On" : "Off"}</b></div>`).join("")}</div></article></section>
    <section class="panel next"><header><p class="eyebrow">NEXT GATE</p><h2>${ready ? "Begin login and checkout tests" : "Configure isolated Firebase and Stripe test projects"}</h2></header><ol><li>Connect a separate Firebase test project and enable Google plus Apple.</li><li>Add Stripe <code>sk_test_</code> credentials and test catalog objects.</li><li>Grant the verified test owner an audited Firebase admin claim.</li><li>Enable one test workflow at a time; leave production integrations off.</li></ol><div class="actions"><button id="refresh" type="button">Refresh status</button><a href="/admin/">Open operations console</a></div></section>
    <footer>Deploy ${escapeHtml(data.deploy || "pending commit metadata")} · Auto-refreshes every 15 seconds</footer>
  </main>`;
  document.querySelector("#refresh")?.addEventListener("click", load);
}

async function load() {
  if (demo) {
    render({
      status: "configuration_required", environment: "test", safeMode: true, deploy: "local-preview",
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
