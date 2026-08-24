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
    expect(admin).toContain("refundableAmount > 0");
    expect(admin).toContain("Number(options.body?.amount)");
    expect(admin).toContain("A partial refund does not revoke access automatically.");
    expect(admin).toContain("function demoConfirmed(options, preview)");
    expect(admin).toContain("Confirmation phrase does not match.");
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
    expect(storefront).toContain('sku: "wonderlangmonthly"');
    expect(storefront).toContain('sku: "wonderlangfull"');
    expect(storefront).toMatch(/const LIFETIME_PRODUCT = \{[\s\S]*?RAW_PRODUCTS\.find[\s\S]*?fallbackPrice: "\$60\.00"[\s\S]*?\};/);
    expect(storefront).toMatch(/const MONTHLY_PRODUCT = \{[\s\S]*?RAW_PRODUCTS\.find[\s\S]*?fallbackPrice: "\$6\.99"[\s\S]*?\};/);
    expect(storefront).toMatch(/function shouldShowChapterOffers\(\)\s*\{\s*return false;\s*\}/);
    expect(storefront).toContain("RESTORE_PRODUCTS");
    expect(storefront).toContain("JavaScript must not infer lifetime access from an undated chapter receipt");
    expect(storefront).not.toContain("const historicalChapterOwned");
    expect(plugins).toContain('{"name":"WonderLangAccountCloudSync","status":true');
    for (const dependency of ["firebase-auth", "credentials-play-services-auth", "googleid"]) {
      expect(gradle).toContain(dependency);
    }
  });

  it("uses a narrow HTTPS WebView origin and conflict-safe cloud save UX", () => {
    const activity = read("integrations/android/current-app-mirror/app/src/main/java/com/example/wonderlang/MainActivity.kt");
    const manifest = read("integrations/android/current-app-mirror/app/src/main/AndroidManifest.xml");
    const api = read("netlify/functions/api.ts");
    const cors = read("storage.cors.json");
    const rmmz = read("integrations/rmmz/WonderLangAccountCloudSync.js");
    const packaged = read("integrations/android/current-app-mirror/app/src/main/assets/js/plugins/WonderLangAccountCloudSync.js");

    expect(manifest).toContain('android:usesCleartextTraffic="false"');
    expect(activity).toContain("WebSettings.MIXED_CONTENT_NEVER_ALLOW");
    expect(activity).toContain("WebView.setWebContentsDebuggingEnabled(webViewDebuggable)");
    expect(activity).toContain('url.startsWith("https://appassets.local/")');
    expect(activity).toContain("Never let an");
    expect(api).toContain('"https://appassets.local"');
    expect(cors).toContain('"https://appassets.local"');
    for (const choice of ["Keep device", "Use cloud", "Not now"]) expect(rmmz).toContain(choice);
    expect(rmmz).toContain("await sha256Hex(bytes)");
    expect(rmmz).toContain("baseRevision: remoteRevision");
    expect(rmmz).toContain("OFFLINE_SUBSCRIPTION_GRACE_MS");
    expect(rmmz).toContain("queueUpload(savefileId, error)");
    expect(rmmz).toContain('window.addEventListener("online"');
    expect(packaged).toBe(rmmz);
  });

  it("publishes a side-effect-free browser harness for testing the RPG Maker UI", () => {
    const page = read("public/rmmz-test/index.html");
    const harness = read("public/rmmz-test/harness.js");
    const buildScript = read("scripts/build-widget.mjs");
    expect(page).toContain("Test account panel");
    expect(page).toContain("Test cloud-save list");
    expect(page).toContain("Test save conflict");
    expect(harness).toContain("mock-firebase-id-token");
    expect(harness).toContain("No real save is touched.");
    expect(harness).toContain("computedAt: new Date().toISOString()");
    expect(harness).toContain("subscriptionEndsAt:");
    expect(harness).not.toContain("STRIPE_SECRET_KEY");
    expect(buildScript).toContain("public/rmmz-test/WonderLangAccountCloudSync.js");
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
    expect(account).toContain("/api/v1/me/deletion-preview");
    expect(account).toContain("/api/v1/me/deletion-commit");
    expect(admin).toContain("cancel-deletion");
  });
});
