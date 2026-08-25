import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("isolated integration configuration", () => {
  it("pins the function runtime to the supported Node 24 LTS line", () => {
    expect(read(".nvmrc").trim()).toBe("24.19.0");
    expect(JSON.parse(read("package.json")).engines.node).toBe(">=24.19 <25");
    expect(read("netlify.toml")).toMatch(/NODE_VERSION\s*=\s*"24\.19\.0"/);
  });

  it("supports customer lookup across account, Stripe, and provider identifiers", () => {
    const operations = read("src/admin/operations-service.ts");
    const admin = read("integrations/web/admin-console/admin.js");
    for (const prefix of ["cus_", "cs_", "pi_", "ch_", "sub_"]) expect(operations).toContain(prefix);
    expect(operations).toContain("uidForProviderTransaction");
    expect(operations).toContain("uidForProviderSubscription");
    expect(admin).toContain("store transaction");
    expect(admin).toContain("PROVIDER IDENTITIES");
    expect(admin).toContain("Retained save inventory");
    expect(admin).toContain("CLOUD STORAGE");
    expect(admin).toContain("staleStagingObjects");
    expect(admin).toContain("cloudSaveCleanup");
    expect(admin).toContain("Revision cleanup queue");
    expect(admin).toContain("data-retry-cleanup");
    expect(operations).toContain("retryCloudSaveCleanup");
    expect(admin).toContain("refundableAmount > 0");
    expect(admin).toContain("Number(options.body?.amount)");
    expect(admin).toContain("A partial refund does not revoke access automatically.");
    expect(admin).toContain("function demoConfirmed(options, preview)");
    expect(admin).toContain("Confirmation phrase does not match.");
    expect(admin).toContain("function minorAmount(currency, majorAmount)");
    expect(admin).not.toContain('confirmationPhrase: "CHANGE MONTHLY TO 7.99 USD"');
    expect(admin).toContain("DEVICE_SIGN_IN_CLEANUP_ENABLED");
    expect(admin).not.toContain("Configured in Netlify");
    expect(admin).toContain("Eligible on request");
  });

  it("uses validated per-tab key-inventory thresholds in alerts and the admin UI", () => {
    const operations = read("src/admin/operations-service.ts");
    const admin = read("integrations/web/admin-console/admin.js");
    const example = read(".env.example");
    expect(operations).toContain("inventoryStockPolicyFromEnvironment");
    expect(operations).toContain("row.lowStock");
    expect(operations).toContain("threshold ${row.lowStockThreshold}");
    expect(admin).toContain("r.lowStock");
    expect(admin).toContain("alert at ${Number(r.lowStockThreshold).toLocaleString()}");
    expect(admin).not.toContain("r.available <= 10");
    expect(example).toMatch(/^KEY_INVENTORY_DEFAULT_LOW_STOCK_THRESHOLD=10$/m);
    expect(example).toMatch(/^KEY_INVENTORY_LOW_STOCK_THRESHOLDS=\{\}$/m);
  });

  it("uses the Netlify-compatible Firebase Admin authentication chain", () => {
    const packageJson = JSON.parse(read("package.json"));
    const packageLock = JSON.parse(read("package-lock.json"));
    expect(packageJson.dependencies["firebase-admin"]).toBe("13.10.0");
    expect(packageLock.packages["node_modules/firebase-admin"].version).toBe("13.10.0");
    expect(packageLock.packages["node_modules/jwks-rsa"].version).toMatch(/^3\./);
  });

  it("wraps every Lambda-style function for the modern Netlify runtime", () => {
    const packageJson = read("package.json");
    const functions = [
      "api",
      "admin-api",
      "apple-webhook",
      "google-play-webhook",
      "health",
      "outbox-worker",
      "stripe-webhook",
      "subscription-reconciliation",
      "cloud-storage-monitor",
      "cloud-save-cleanup",
      "device-sign-in-cleanup",
    ];

    expect(packageJson).toContain('"@netlify/aws-lambda-compat"');
    for (const functionName of functions) {
      const source = read(`netlify/functions/${functionName}.ts`);
      expect(source).toContain('from "@netlify/aws-lambda-compat"');
      expect(source).toContain("export default withLambda(lambdaHandler);");
      expect(source).not.toMatch(/export\s+const\s+handler\b/);
    }
  });

  it("points duplicate mobile adapters at the isolated entitlement service", () => {
    const rmmz = read("integrations/rmmz/WonderLangAccountCloudSync.js");
    const ios = read("integrations/ios/WonderLangEntitlementStore.swift");
    for (const source of [rmmz, ios]) {
      expect(source).toContain("https://wl-purchase-entitlement.netlify.app");
      expect(source).not.toContain("https://purchased-keys-automation.netlify.app");
    }
  });

  it("schedules the outbox worker while keeping processing disabled by default", () => {
    const netlify = read("netlify.toml");
    const example = read(".env.example");
    expect(netlify).toMatch(/\[functions\."outbox-worker"\][\s\S]*schedule\s*=\s*"\*\/5 \* \* \* \*"/);
    expect(example).toMatch(/^OUTBOX_PROCESSING_ENABLED=false$/m);
    expect(example).toMatch(/^LEGACY_FULFILLMENT_ENABLED=false$/m);
    expect(example).toMatch(/^ACCOUNT_DELETION_PROCESSING_ENABLED=false$/m);
    expect(example).toMatch(/^APP_CHECK_ENFORCEMENT_ENABLED=false$/m);
    expect(example).toMatch(/^SUBSCRIPTION_RECONCILIATION_ENABLED=false$/m);
    expect(example).toMatch(/^PROVIDER_TOKEN_ENCRYPTION_KEYS=$/m);
    expect(example).toMatch(/^CLOUD_STORAGE_MONITORING_ENABLED=false$/m);
    expect(example).toMatch(/^CLOUD_SAVE_CLEANUP_ENABLED=false$/m);
    expect(example).toMatch(/^DEVICE_SIGN_IN_ENABLED=false$/m);
    expect(example).toMatch(/^DEVICE_SIGN_IN_CLEANUP_ENABLED=false$/m);
    expect(netlify).toMatch(/\[functions\."subscription-reconciliation"\][\s\S]*schedule\s*=\s*"17 \* \* \* \*"/);
    expect(netlify).toMatch(/\[functions\."cloud-storage-monitor"\][\s\S]*schedule\s*=\s*"43 2 \* \* \*"/);
    expect(netlify).toMatch(/\[functions\."cloud-save-cleanup"\][\s\S]*schedule\s*=\s*"23 \* \* \* \*"/);
    expect(netlify).toMatch(/\[functions\."device-sign-in-cleanup"\][\s\S]*schedule\s*=\s*"7 \* \* \* \*"/);
  });

  it("keeps scheduled reconciliation read-only at every billing provider", () => {
    const stripe = read("src/providers/stripe/event-processor.ts");
    const play = read("src/providers/google-play/service.ts");
    const apple = read("src/providers/apple/service.ts");
    const worker = read("netlify/functions/subscription-reconciliation.ts");
    expect(stripe).toContain("reconcileStripeSubscription");
    expect(stripe).toContain("subscriptions.retrieve");
    expect(play).toContain("reconcileGooglePlaySubscription");
    expect(play).toContain("acknowledge: false");
    expect(apple).toContain("reconcileAppleSubscription");
    expect(apple).toContain("getAllSubscriptionStatuses");
    expect(worker).toContain("SUBSCRIPTION_RECONCILIATION_ENABLED");
    expect(worker).not.toMatch(/cancel|refund|acknowledge/i);
  });

  it("requests the verified Apple identity fields used for secure account linking", () => {
    const widget = read("integrations/web/account-widget/wonderlang-account.js");
    expect(widget).toContain('new OAuthProvider("apple.com")');
    expect(widget).toContain('provider.addScope("email")');
    expect(widget).toContain('provider.addScope("name")');
  });

  it("publishes a host-restricted, side-effect-free account UI demo", () => {
    const widget = read("integrations/web/account-widget/wonderlang-account.js");
    const page = read("public/account/index.html");
    const headers = read("public/_headers");
    expect(widget).toContain('"wl-purchase-entitlement.netlify.app"');
    expect(widget).toContain('previewParam === "1"');
    expect(widget).toContain("if (demoMode) return this.demoRequest(path, options)");
    expect(widget).toContain("no real sign-in, purchase, save, or deletion can occur.");
    expect(widget).toContain("No payment page was opened.");
    expect(widget).toContain('phraseInput.addEventListener("input", () => phraseInput.setCustomValidity(""))');
    expect(widget).toMatch(/await this\.renderUser\(this\.user\);\s*this\.status\("Desktop purchase verified\./);
    expect(page).toMatch(/wonderlang-account\.js\?v=/);
    expect(headers).toContain("Cache-Control: public, max-age=0, must-revalidate");
    for (const asset of ["/admin.js", "/admin.css", "/setup.js", "/setup.css"]) expect(headers).toContain(asset);
  });

  it("never substitutes simulated admin data when real configuration is missing", () => {
    const admin = read("integrations/web/admin-console/admin.js");
    expect(admin).toContain("SIMULATED DEMO — NOT LIVE DATA");
    expect(admin).toContain("Demo actions never call Firebase");
    expect(admin).not.toMatch(/catch \(error\) \{\s*if \(previewHosts\.has\(location\.hostname\)\)/);
  });

  it("requires explicit customer approval for PC/Mac device sign-in", () => {
    const account = read("integrations/web/account-widget/wonderlang-account.js");
    expect(account).toContain('data-action="approve-device"');
    expect(account).toContain("code on this page exactly matches the code currently shown inside WonderLang");
    expect(account).toContain("/api/v1/device-sign-in/preview?code=");
    expect(account).toContain('this.request("/api/v1/device-sign-in/approve"');
    expect(account).toContain('data-field="future-content"');
    expect(account).toContain('data-field="second-platform"');
  });

  it("keeps the PC/Mac custom-token exchange out of Git-hosted credentials", () => {
    const bridge = read("integrations/rmmz/WonderLangDesktopAccountBridge.js");
    const account = read("integrations/rmmz/WonderLangAccountCloudSync.js");
    const api = read("netlify/functions/api.ts");
    expect(bridge).toContain("/api/v1/device-sign-in/config");
    expect(bridge).toContain("/api/v1/device-sign-in/start");
    expect(bridge).toContain("/api/v1/device-sign-in/poll");
    expect(bridge).toContain("accounts:signInWithCustomToken");
    expect(bridge).toContain("securetoken.googleapis.com/v1/token");
    expect(bridge).toContain("wonderlang-account-session-v1.json");
    expect(bridge).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    expect(api).toContain('path === "/v1/device-sign-in/config"');
    expect(api).toContain("FIREBASE_WEB_API_KEY");
    expect(account).toContain("Approve this PC/Mac");
    expect(account).toContain("wl-device-sign-in-state");
    expect(account).toContain('button.addEventListener("touchend"');
  });

  it("keeps mobile admin actions at a touch-safe minimum size", () => {
    const css = read("integrations/web/admin-console/admin.css");
    expect(css).toMatch(/\.button \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.text-button \{[^}]*min-width: 44px; min-height: 44px/);
    expect(css).toMatch(/\.mobile-menu \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.user-menu \{[^}]*min-height: 44px/);
  });

  it("keeps setup actions at a touch-safe minimum size", () => {
    const css = read("integrations/web/setup-status/setup.css");
    expect(css).toMatch(/\.actions button,\.actions a,\.failure button \{[^}]*min-height:44px/);
  });

  it("closes the native Play verification loop for both success and failure", () => {
    const bridge = read("integrations/android/current-app-mirror/app/src/main/java/com/example/wonderlang/WonderLangAccountManager.kt");
    const rmmz = read("integrations/rmmz/WonderLangAccountCloudSync.js");
    for (const callback of ["_nativePurchaseVerified", "_nativePurchaseFailed"]) {
      expect(bridge).toContain(callback);
      expect(rmmz).toContain(callback);
    }
    expect(rmmz).toContain("wl-purchase-verification-complete");
  });

  it("keeps the Android migration server-authoritative and subscription-aware", () => {
    const activity = read("integrations/android/current-app-mirror/app/src/main/java/com/example/wonderlang/MainActivity.kt");
    const manager = read("integrations/android/current-app-mirror/app/src/main/java/com/example/wonderlang/WonderLangAccountManager.kt");
    const entitlementFirebase = read("integrations/android/current-app-mirror/app/src/main/res/values/wonderlang_entitlements.xml");
    const storefront = read("integrations/android/current-app-mirror/app/src/main/assets/js/plugins/AndroidAssetDownloader.js");
    const plugins = read("integrations/android/current-app-mirror/app/src/main/assets/js/plugins.js");
    const gradle = read("integrations/android/current-app-mirror/app/build.gradle.kts");

    expect(activity).toContain('private val SUBS_SKUS = setOf("wonderlangmonthly")');
    expect(activity).toContain('private val IN_APP_SKUS = setOf("wonderlangch1", "wonderlangch2", "wonderlangch3", "wonderlangch4", "wonderlangfull")');
    expect(activity).toContain('private val POLYGLOT_PURCHASE_OPTION_ID = "buy-polyglot-permanent"');
    expect(activity).toContain("offer.purchaseOptionId == POLYGLOT_PURCHASE_OPTION_ID");
    expect(activity).toContain('normalizedSku in SUBS_SKUS || normalizedSku == "wonderlangfull"');
    expect(activity).toMatch(/storePrice = StoreProductPrice\([\s\S]*?offerToken = offer\.offerToken/);
    expect(activity).toContain("BillingClient.ProductType.SUBS");
    expect(activity).toContain("setObfuscatedAccountId(storeAccountToken)");
    expect(activity).toContain("preferredSubscriptionOffer");
    expect(activity).toContain("LEGACY_CHAPTER_FULL_UPGRADE_CUTOFF_MS = 1_787_615_999_999L");
    expect(activity).toContain("historicalFullUpgradeProducts");
    expect(activity).toContain('purchasedProducts.any { it in CHAPTER_SKUS } -> "chapter"');
    expect(activity).not.toContain("acknowledgePurchase(");
    expect(manager).toContain('api("/api/v1/google-play/claim"');
    expect(manager).toContain('OAuthProvider.newBuilder("apple.com")');
    expect(manager).toContain("FirebaseAuth.getInstance(entitlementFirebaseApp)");
    expect(manager).toContain("R.string.wonderlang_entitlements_google_web_client_id");
    expect(manager).not.toContain("R.string.default_web_client_id");
    expect(entitlementFirebase).toContain("wonderlang-entitlements-9590f");
    expect(entitlementFirebase).toContain("apps.googleusercontent.com");
    expect(entitlementFirebase).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    expect(gradle).toContain('environmentVariable("WONDERLANG_ENTITLEMENTS_FIREBASE_API_KEY")');
    expect(gradle).toContain("resValues = true");
    expect(manager).toContain("GetGoogleIdOption.Builder()");
    expect(manager).toContain("sendSignInLinkToEmail");
    expect(manager).toContain('entitlements.optJSONArray("mobilePlatforms")');
    expect(manager).toContain('equals("android", ignoreCase = true)');
    expect(storefront).toContain('sku: "wonderlangmonthly"');
    expect(storefront).toContain('sku: "wonderlangfull"');
    expect(storefront).toMatch(/const POLYGLOT_PRODUCT = \{[\s\S]*?RAW_PRODUCTS\.find[\s\S]*?fallbackPrice: "\$31\.99"[\s\S]*?\};/);
    expect(storefront).toMatch(/const MONTHLY_PRODUCT = \{[\s\S]*?RAW_PRODUCTS\.find[\s\S]*?fallbackPrice: "\$6\.99"[\s\S]*?\};/);
    expect(storefront).toMatch(/function shouldShowChapterOffers\(\)\s*\{\s*return false;\s*\}/);
    expect(storefront).toContain("RESTORE_PRODUCTS");
    expect(storefront).toContain("JavaScript must not infer permanent full access from an undated chapter receipt");
    expect(storefront).not.toContain("const historicalChapterOwned");
    expect(plugins).toContain('{"name":"WonderLangAccountCloudSync","status":true');
    expect(plugins).toContain("Polyglot Permanent Access");
    expect(plugins).toContain("$31.99");
    expect(plugins).not.toContain('$25.99');
    for (const dependency of ["firebase-auth", "credentials-play-services-auth", "googleid"]) {
      expect(gradle).toContain(dependency);
    }
  });

  it("uses a narrow HTTPS WebView origin and conflict-safe cloud save UX", () => {
    const activity = read("integrations/android/current-app-mirror/app/src/main/java/com/example/wonderlang/MainActivity.kt");
    const manifest = read("integrations/android/current-app-mirror/app/src/main/AndroidManifest.xml");
    const api = read("netlify/functions/api.ts");
    const originPolicy = read("src/http/origin.ts");
    const cloudSave = read("src/cloud-save/service.ts");
    const adminApi = read("netlify/functions/admin-api.ts");
    const cors = read("storage.cors.json");
    const rmmz = read("integrations/rmmz/WonderLangAccountCloudSync.js");
    const packaged = read("integrations/android/current-app-mirror/app/src/main/assets/js/plugins/WonderLangAccountCloudSync.js");

    expect(manifest).toContain('android:usesCleartextTraffic="false"');
    expect(activity).toContain("WebSettings.MIXED_CONTENT_NEVER_ALLOW");
    expect(activity).toContain("WebView.setWebContentsDebuggingEnabled(webViewDebuggable)");
    expect(activity).toContain('url.startsWith("https://appassets.local/")');
    expect(activity).toContain("Never let an");
    expect(api).toContain("apiAllowedOrigins(true)");
    expect(originPolicy).toContain('"https://appassets.local"');
    expect(cors).toContain('"https://appassets.local"');
    expect(cloudSave).toContain("cloud-save-uploads/${uid}/${uploadId}.json");
    expect(cloudSave).toContain("preconditionOpts: { ifGenerationMatch: 0 }");
    expect(cloudSave).toContain("objectPath: revisionObjectPath");
    expect(cloudSave).toContain("cloudSaveSlotSchema");
    expect(api).toContain("cloudSaveSlotSchema.safeParse");
    const accountDeletion = read("src/account-deletion/service.ts");
    expect(accountDeletion).toContain("cloud-save-uploads/${uid}/");
    expect(accountDeletion).toContain('collection("cloudSaveCleanupJobs")');
    expect(adminApi).toContain("...(row.mobilePlatform ? { mobilePlatform: row.mobilePlatform } : {})");
    for (const choice of ["Keep device", "Use cloud", "Not now"]) expect(rmmz).toContain(choice);
    expect(rmmz).toContain("await sha256Hex(bytes)");
    expect(rmmz).toContain("baseRevision: remoteRevision");
    expect(rmmz).toContain("OFFLINE_SUBSCRIPTION_GRACE_MS");
    expect(rmmz).toContain("restrictToGrantedPlatform");
    expect(rmmz).toContain("mobilePlatforms");
    expect(rmmz).toContain("queueUpload(savefileId, error)");
    expect(rmmz).toContain('window.addEventListener("online"');
    expect(packaged).toBe(rmmz);
  });

  it("bounds cloud-save retention and expires only abandoned staging uploads", () => {
    const lifecycle = JSON.parse(read("storage.lifecycle.json"));
    expect(lifecycle).toEqual({
      rule: [{ action: { type: "Delete" }, condition: { age: 1, matchesPrefix: ["cloud-save-uploads/"] } }]
    });
    expect(JSON.stringify(lifecycle)).not.toContain("cloud-saves/");
    const cleanup = read("src/cloud-save/cleanup-service.ts");
    expect(cleanup).toContain("isSafeCloudRevisionObjectPath(objectPath, job.uid)");
    expect(cleanup).toContain("MAX_ATTEMPTS = 10");
  });

  it("publishes a side-effect-free browser harness for testing the RPG Maker UI", () => {
    const page = read("public/rmmz-test/index.html");
    const harness = read("public/rmmz-test/harness.js");
    const buildScript = read("scripts/build-widget.mjs");
    expect(page).toContain("Test account panel");
    expect(page).toContain("Test PC/Mac sign-in");
    expect(page).toContain("Test cloud-save list");
    expect(page).toContain("Test save conflict");
    expect(harness).toContain("mock-firebase-id-token");
    expect(harness).toContain("No real save is touched.");
    expect(harness).toContain('userCode: "ABCD-2345"');
    expect(harness).toContain("computedAt: new Date().toISOString()");
    expect(harness).toContain("subscriptionEndsAt:");
    expect(harness).not.toContain("STRIPE_SECRET_KEY");
    expect(buildScript).toContain("public/rmmz-test/WonderLangAccountCloudSync.js");
    expect(buildScript).toContain("public/rmmz-test/WonderLangDesktopAccountBridge.js");
    expect(buildScript).toContain("integrations/android/current-app-mirror/app/src/main/assets/js/plugins/WonderLangAccountCloudSync.js");
  });

  it("uses accessible in-console forms instead of blocking prompt dialogs", () => {
    const admin = read("integrations/web/admin-console/admin.js");
    const account = read("integrations/web/account-widget/wonderlang-account.js");
    const accountCss = read("integrations/web/account-widget/wonderlang-account.css");
    expect(admin).not.toMatch(/\bprompt\s*\(/);
    expect(account).not.toMatch(/\bprompt\s*\(/);
    expect(admin).toContain('role="dialog"');
    expect(admin).toContain('aria-modal="true"');
    expect(account).toContain('role="dialog"');
    expect(account).toContain('aria-modal="true"');
    expect(accountCss).toContain("wonderlang-account button");
    expect(accountCss).toContain("wonderlang-account input");
    expect(admin).toContain("state.notice");
    expect(admin).toContain("ZERO_DECIMAL_CURRENCIES.has(normalizedCurrency) ? 1 : 100");
    expect(admin).toContain("amount: minorAmount(currencyCode, amountText)");
    expect(admin).toContain('step="${zeroDecimal ? "1" : "0.01"}"');
    expect(account).toContain("/api/v1/me/deletion-preview");
    expect(account).toContain("/api/v1/me/deletion-commit");
    expect(account).toContain("EmailAuthProvider.credentialWithLink");
    expect(account).toContain("linkWithCredential(current, credential)");
    expect(account).toContain("current.uid !== intendedUid");
    expect(account).toContain('data-action="link-email"');
    expect(admin).toContain("cancel-deletion");
  });
});
