# Full-goal completion audit

Last audited: 2026-08-25. A status of **implemented** means current source plus focused automated tests prove the behavior. It does not replace a provider, browser, store-sandbox, or physical-device acceptance test where one is required.

## Implemented and locally verified

| Requirement | Authoritative evidence |
| --- | --- |
| One server-authoritative WonderLang identity and entitlement account | Firebase ID-token verification, account summaries and provider/customer uniqueness indexes in `src`, exercised by the auth, domain and staging-handler suites. |
| Google, Apple and passwordless-email client flows; provider linking | Website widget and Android/desktop integration code, with route/UI/error contract tests. Google has reached the real staging backend for one test account. |
| Recovery, sign-out, all-device revocation and 30-day deletion | Account API, account-deletion service, generation-bound device sessions and customer UI; focused unit, contract and emulator coverage. |
| Stripe, Play, Apple, historical, import and manual-grant ledger | Append-only provider inbox, normalized grants, uniqueness indexes and entitlement projector; provider, migration, refund and out-of-order-event tests. |
| Monthly, platform-scoped Polyglot and website-only Premium commercial rules | Catalog/domain policy and crafted-checkout rejection tests. Historical chapter migration preserves the original Android/iOS platform. |
| Versioned cross-platform cloud saves | Slots `save0`–`save20`, SHA-256/size checks, immutable revisions, current-plus-three retention, 409 conflict preservation, offline retry integration and cleanup queue tests. |
| Real customer account interface | Deployed `/account/` routes and executable client-to-API contracts for every action; the safe demo and one real Google account have been exercised. |
| Real administrator console | Deployed `/admin/` sections for customers, entitlements, requests, refunds, prices, imports, operations, inventory, saves, audit and settings; every operation family has executable route contracts and safe-demo state transitions. |
| Legacy key fulfillment, MailerLite and advertising integration | Transactional key allocation, deduplicated outbox, Google Sheets/MailerLite adapters and Meta/TikTok senders with privacy and duplicate-event tests. All live side effects remain disabled. |
| Android integration | Maintained mirror plus synchronized authoritative Android files, named Firebase account app, Billing bridge, backend verification, App Links, App Check plumbing, restore logic and `buy-polyglot-permanent`; Kotlin and JavaScript builds/checks pass. |
| PC/Mac and RPG Maker MZ integration | Device-code bridge, Firebase token exchange/refresh/revocation, local-first cloud-save plugin and guarded real-NW.js staging harness. |
| iOS integration source | Reviewed StoreKit 2 adapter with `appAccountToken`, JWS claim and restore behavior. The real Xcode integration cannot be completed until the project is supplied. |
| Security baseline | Test-key enforcement, disabled-by-default side effects, deny-by-default Firestore/Storage rules, origin/rate-limit/App Check verification, encrypted provider tokens, redacted outbox payloads and audited admin actions. |

Current verification run: 223 ordinary unit/integration/contract tests passed, 13 isolated Firestore/Storage emulator tests passed, and the production TypeScript/widget build passed.

## Configured externally but still gated

- Netlify `wl-purchase-entitlement` is linked and deployed in test safe mode. Firebase Admin/web, Google Sheets/MailerLite, Google Play verification/RTDN and provider-token encryption are present; all processing switches remain off.
- Firebase `wonderlang-accounts` is on Blaze and has Firestore/Storage security configuration. Google and email/password providers are enabled. Apple remains unsaved until a usable Sign in with Apple private key is installed.
- Google Play has Monthly and the draft `buy-polyglot-permanent` option. The legacy `buy` option remains live at the old price until the compatible Android update ships.
- Apple has Monthly, the three-day trial, Polyglot and historical restore products. Sign in with Apple domain/callback configuration is correct.
- Stripe test products and the approved Premium USD 59.99 Price exist. A restricted test API key and webhook signing secret are still absent.

## Evidence still required before production

1. Revoke the two unusable Apple Sign in keys, create/download one usable replacement, save it in Firebase Authentication, and run real Apple web login.
2. Create a separate App Store Connect Server API key, install its issuer/key/private-key credentials in Netlify, configure Notifications V2, and run Apple Sandbox purchase, renewal, grace, expiration, refund and restore tests.
3. Create a restricted Stripe test key and webhook endpoint/secret, install them in Netlify, validate the catalog, and exercise Checkout, Portal, webhook replay, refund, dispute and subscriber-to-Premium cancellation ordering.
4. Grant one verified Firebase user the audited admin claim, immediately disable bootstrap again, and exercise the real protected administrator routes.
5. Run a Play internal-track license-tester matrix for Monthly, Polyglot, pending/cancel/refund/grace/restore and backend acknowledgment.
6. Run the complete physical-device Android tap/scroll/double-tap matrix and installed passwordless-email App Link test.
7. Enable PC/Mac device-sign-in only in staging and perform the real game → browser approval → game token exchange, refresh and all-device revocation test.
8. Run two real installations through cloud upload, restore, corruption rejection, 409 conflict choice, lapse and recovery; then canary monitoring and cleanup before enabling their workers.
9. Run one intentionally isolated legacy fulfillment canary and advertising test-event canary, proving exactly one key/email/Sheet/ad event, before migrating the existing automation.
10. Integrate and compile the supplied iOS Xcode project when available, then repeat account, purchase and cloud-save acceptance tests on a physical iOS device.
11. Resolve/restrict the historically exposed Firebase Android client key and close the GitHub secret-scanning alert.
12. Publish the privacy/terms changes and finish store tax/account paperwork before production sales.

Production processing must remain disabled until the relevant item above has passed in staging and its result is recorded in `STAGING_PROVIDER_STATUS.md`.
