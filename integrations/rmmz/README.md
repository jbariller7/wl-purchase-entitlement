# RPG Maker MZ duplicate integration

`WonderLangAccountCloudSync.js` is a new standalone plugin. It keeps every local save authoritative first, uploads only after local success, validates SHA-256 in both directions, retains revision IDs, and never deletes cloud data when access lapses.

`WonderLangDesktopAccountBridge.js` supplies the missing NW.js PC/Mac identity bridge. In a duplicated desktop test build, load it immediately before `WonderLangAccountCloudSync`. Do not enable either plugin in the published desktop build until the real-engine device-code test passes.

The desktop flow is:

1. The game requests a ten-minute code and separate high-entropy polling secret.
2. It displays the code in-game and opens the approval page in the system browser.
3. The player signs in with Google, Apple, or email and explicitly approves the matching code.
4. The game receives a one-time Firebase custom token, exchanges it directly with Firebase over HTTPS, and exposes only the short-lived ID token to the cloud-save plugin.
5. NW.js retains only the refresh token in its per-user app-data directory (`0600` on Unix-like systems; inherited per-user application-data ACLs on Windows). It never writes the polling secret, custom token, Firebase API key, or private credential to disk.

The Firebase Web API key is public client configuration, but it is still not committed or bundled. The bridge obtains it at runtime from `/api/v1/device-sign-in/config`; Netlify reads it from `FIREBASE_WEB_API_KEY`. The returned Firebase ID token is rejected unless its audience and issuer match the configured entitlement project.

Duplicate-build plugin order:

```text
WonderLangDesktopAccountBridge   status: true
WonderLangAccountCloudSync       status: true
```

Both use this test parameter:

```text
ApiBaseUrl = https://wl-purchase-entitlement.netlify.app
```

The guarded preparation script also adds `WonderLangDesktopRuntimeProbe` as the
first plugin only in the disposable desktop copy, so it can record even an
early boot failure. The probe uses a distinct NW.js application name,
refuses to run without the managed-build marker, records the real engine/plugin
state only after RPG Maker reaches a scene, computed account-panel
visibility/layout, redacted Firebase client-configuration readiness, a live
start-to-pending-poll device-sign-in contract with no pre-approval token, and
fail-closed sign-in behavior,
then exits. It must
never be copied into or enabled in the production game.

On Windows, `WonderLang.exe` by itself is only the NW.js front executable. The
preparation script verifies the complete installed RPG Maker MZ `nwjs-win`
runtime (`nw.exe`, `nw.dll`, and `resources.pak`) and writes the disposable
`Run-WonderLang-Entitlement-Test.cmd` launcher. The runtime is used read-only;
it is not copied into Git or modified.

The duplicate-build default is the isolated `https://wl-purchase-entitlement.netlify.app` test service. Production builds must override `ApiBaseUrl` deliberately during the release cutover; never point a test build back at `purchased-keys-automation`.

The paywall duplicate should merge ownership as follows:

```js
const nativeOwned = isDirectProductPurchased(sku);
const accountOwned = window.WLAccountEntitlements?.isProductPurchased(sku) === true;
return nativeOwned || accountOwned;
```

Existing chapter and `wonderlangfull` purchases must still be queried/restored. The new storefront may stop selling chapter SKUs, but it must not stop honoring them.

The Android bridge reports every backend-verified purchase through `_nativePurchaseVerified`, which immediately updates the cached entitlement and emits `wl-purchase-verification-complete`. Verification failures emit the same event with `{ ok: false }` so a duplicate paywall can always release its in-flight lock and remain retryable.

Offline policy: a previously server-verified Polyglot Permanent, Premium Lifetime, or migrated legacy purchase remains usable offline only on a granted `mobilePlatforms` value. A subscription cache is usable until the later of its last verified paid-period end or seven days after the last server computation; a provider payment-grace cache ends at the provider deadline. A missing, malformed, future-dated, or wrong-platform server snapshot fails closed. Failed cloud uploads are stored per account and slot with exponential backoff, retried on a verified refresh and when connectivity returns, and never bypass conflict confirmation.

Do not auto-restore a remote slot over a different local slot. Present the timestamps/revisions and ask the player which copy to keep when the backend returns HTTP 409.
