import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("isolated integration configuration", () => {
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
  });

  it("requests the verified Apple identity fields used for secure account linking", () => {
    const widget = read("integrations/web/account-widget/wonderlang-account.js");
    expect(widget).toContain('new OAuthProvider("apple.com")');
    expect(widget).toContain('provider.addScope("email")');
    expect(widget).toContain('provider.addScope("name")');
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
    const storefront = read("integrations/android/current-app-mirror/app/src/main/assets/js/plugins/AndroidAssetDownloader.js");
    const plugins = read("integrations/android/current-app-mirror/app/src/main/assets/js/plugins.js");
    const gradle = read("integrations/android/current-app-mirror/app/build.gradle.kts");

    expect(activity).toContain('private val SUBS_SKUS = setOf("wonderlangmonthly")');
    expect(activity).toContain("BillingClient.ProductType.SUBS");
    expect(activity).toContain("setObfuscatedAccountId(storeAccountToken)");
    expect(activity).toContain("preferredSubscriptionOffer");
    expect(activity).not.toContain("acknowledgePurchase(");
    expect(manager).toContain('api("/api/v1/google-play/claim"');
    expect(manager).toContain('OAuthProvider.newBuilder("apple.com")');
    expect(manager).toContain("GetGoogleIdOption.Builder()");
    expect(manager).toContain("sendSignInLinkToEmail");
    expect(storefront).toContain('sku: "wonderlangmonthly"');
    expect(storefront).toContain('sku: "wonderlangfull"');
    expect(storefront).toMatch(/function shouldShowChapterOffers\(\)\s*\{\s*return false;\s*\}/);
    expect(storefront).toContain("RESTORE_PRODUCTS");
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
    expect(harness).not.toContain("STRIPE_SECRET_KEY");
    expect(buildScript).toContain("public/rmmz-test/WonderLangAccountCloudSync.js");
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
  });
});
