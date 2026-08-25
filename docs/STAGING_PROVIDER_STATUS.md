# Staging provider status

Last verified: 2026-08-25. This file records only non-secret identifiers and safety state.

## Safety state

- Netlify site: `wl-purchase-entitlement.netlify.app`
- Firebase test project: `wonderlang-entitlements-9590f`
- Stripe is test mode only.
- Apple purchases are `Prepare for Submission` / Sandbox configuration.
- All fulfillment, advertising, webhook-processing, cancellation, deletion-processing, outbox, Stripe-mutation, subscription-reconciliation, cloud-storage-monitoring, cloud-save-cleanup, PC/Mac device-sign-in and device-code-cleanup switches remain disabled.
- Secret material is stored only in Netlify secret-scoped variables or ignored local build configuration. Never add values to this file.

## Firebase

- Firestore default database: Standard edition, `europe-west9`, client rules deny all.
- Authentication providers enabled: Email/Password and Google.
- Apple provider is pending its private-key configuration.
- Android app: package `com.wonderlang.app`, Firebase app ID `1:769128191668:android:211c0685b2f5ee016d69e1`.
- Debug, upload and Play App Signing SHA-1 certificates are registered.
- Storage requires Blaze. Blaze has no fixed monthly fee but is pay-as-you-go beyond its no-cost quotas; billing-account linking remains pending the account owner's informed confirmation.
- The checked-in lifecycle policy is not deployed yet. Once Blaze and the staging bucket are approved, it will delete only abandoned `cloud-save-uploads/` objects after one day; it never targets retained revisions.
- The Android Firebase client key is injected from `WONDERLANG_ENTITLEMENTS_FIREBASE_API_KEY` in ignored `local.properties` or the Android build environment. It is not tracked in Git.

## Netlify staging deployment

- Verified production UI/application build: `dd8cbac` (Netlify deploy `6a8cfa767423b90008ad1e23`). The published cloud-save retention/cleanup baseline is `580511e` (Netlify deploy `6a8ce2733483ab0008e01166`), the secure NW.js device-sign-in baseline is `4f62c63`, and the earlier honest-UI baseline was `cfd177b`.
- `APP_ENVIRONMENT=test` in every deploy context.
- Stripe, Google Play and Apple webhook processing; the async worker; ad conversions; legacy fulfillment; subscription cancellation; account-deletion processing; Stripe mutations; scheduled subscription reconciliation; aggregate cloud-storage monitoring; cloud-save revision cleanup; PC/Mac device sign-in; and expired device-code cleanup are all `false` in every deploy context.
- Runtime readiness reports 2 of 8 connection groups ready: Firebase web configuration and the copied Sheets/MailerLite credentials. Firebase Admin, Stripe test secrets, ad-test delivery, Google Play server verification, App Store server verification and the Netlify-only provider-token encryption key ring remain intentionally unavailable.
- Key inventory alerts currently use the validated default minimum of 10. No `KEY_INVENTORY_LOW_STOCK_THRESHOLDS` per-tab overrides are installed until the actual Steam/Itch replenishment minimums are chosen.
- Browser smoke testing passed for the `/` redirect, all eight `/admin/` sections, `/account/?demo=1`, `/setup/`, and `/rmmz-test/`. The admin page never silently substitutes demo records when configuration is missing; it displays the real configuration gate. Simulated data requires an explicit `?demo=1` and both customer/admin demos display prominent non-live warnings. Build `6ffa53e` was exercised interactively both locally and from its published Netlify deployment: customer lookup; administrator grant/revoke; account disable/re-enable; session and deletion controls; partial refund with typed confirmation; regional Stripe price replacement while preserving USD and other currencies; CSV import; outbox, cloud-save-cleanup and provider-event retries; alert routing; Google demo sign-in; PC/Mac code preview/approval with removal of `device_code` from the URL; provider-specific subscription management; monthly/Polyglot/Premium checkout gates; and exact-phrase account deletion all produced the intended state transitions. On the published deployment, a two-step EUR Monthly demo change updated the regional row from 6.49 to 7.49 while the USD 6.99 default remained unchanged. Deploy `dd8cbac` adds a durable Premium second-mobile-platform request: the published customer demo submitted and canceled the included iOS request, and the published Admin queue opened and approved it, removed it from the open count, granted permanent iOS access and exposed the immutable audit action without browser warnings/errors. The same build's local safe demo also exercised decline. Fresh 390-pixel checks of the signed-in customer request state and the full Admin customer/decision view have no page-level horizontal overflow; a discovered single-column grid min-content overflow was fixed before deployment. Every rendered customer action/form and every administrator operation family now has an executable client-to-protected-route contract test, including loading, error, empty, permission, disabled, success and explicit-demo states. Admin tables escape all provider/customer strings and permit markup only through an internal symbol-branded cell. Admin Operations renders scheduled-reconciliation history, aggregate token-vault key counts and aggregate Cloud Storage metrics without tokens, player IDs or object paths.
- Netlify confirms 11 deployed functions. `cloud-save-cleanup` is registered as a scheduled function, while the published health endpoint reports `environment=test`, `safeMode=true`, `status=configuration_required`, and `CLOUD_SAVE_CLEANUP_ENABLED=false`. It was deliberately not manually invoked against the real deployment while disabled-state proof is already covered locally.
- The isolated RPG Maker UI test passed the account panel, cloud-save list, non-destructive save-conflict dialog, and the new PC/Mac code-matching/cancel flow. The live `4f62c63` page renders `ABCD-2345` only as explicitly simulated data, has no browser warnings/errors, and the same UI has no horizontal overflow at 390 pixels.
- Current local gates: all 129 unit/integration/contract tests and all 13 isolated Firestore/Storage emulator tests passed (142/142 across both gates), TypeScript and production asset build passed, every changed/generated browser JavaScript file passed syntax validation, the production dependency audit reports zero vulnerabilities, and the working-tree scan finds no API-key, Stripe-secret, webhook-secret, or private-key shapes. Five focused Premium request tests prove eligibility derivation, privacy-reduced customer responses, idempotent submission/cancellation/resubmission, deterministic approval grants, immutable approval/decline audits, duplicate-decision safety and open-queue removal. New mixed-ownership tests prove that a monthly subscriber can buy permanent access, an already-owned permanent platform cannot be repurchased, and Premium owners are directed to the audited second-platform request instead of being sold another Polyglot purchase. The entitlement API separately reports current mobile access and permanent mobile ownership; subscription totals no longer disappear when the same account also owns a permanent product. The emulator used only `demo-wonderlang-entitlements`; non-emulated service access therefore failed closed. Device-flow tests cover code normalization, account-bound approval, wrong-secret rejection, issuance leasing, abandoned-lease recovery, one-time consumption, secret hashing and bounded revocation/expiry cleanup. NW.js bridge tests cover runtime-only Firebase configuration, custom-token exchange, project issuer/audience validation, refresh-token persistence and rotation, reload, sign-out deletion, and proof that polling/custom-token values never enter UI events or persistent files. Inventory-policy tests prove validated defaults, exact per-tab overrides, deliberate zero thresholds, malformed-value rejection and typo rejection for unknown Sheet tabs. The storage-monitor suite proves exact-prefix metadata-only inventory, aggregate growth/stale-upload calculations, malformed-size rejection and generic failure persistence without object paths. Cloud-save tests prove that only `save0` through `save20` are accepted, five generations converge to the current plus three predecessors, pruned files are deleted, cross-account or non-revision paths fail closed, provider errors remain sanitized, retries back off, terminal jobs can be audited/requeued, and account deletion removes queued cleanup work. The deployed API rejects an untrusted browser Origin with 403 and no allow-origin response, while the approved WonderLang Origin still reaches the safe configuration gate. Authenticated account and administrator APIs have atomic per-account/action limits backed by hashed Firestore keys; failures reject protected requests. Firebase App Check verification is present but its enforcement switch remains false until all clients are provisioned. The reconciliation suite proves authenticated encryption and key rotation, lease exclusion, provider-failure isolation, daily scheduling, revoked-subscription shutdown, and deletion-race resistance; a late provider response cannot recreate an erased Play token or re-enable a deleted account's retained subscription link. The emulator suite also proves that provider inboxes retain only payload digests, completed outbox payloads are redacted, and final account deletion pseudonymizes linked orders/ledger rows while canceling unfinished personal side effects. Provider-mocked tests prove that final deletion clears only Google Sheet email cells and issues MailerLite GDPR forget requests; a live external deletion canary is still required before enabling deletion processing.

## Stripe test catalog

- Mobile Monthly product: `prod_V88ycRQwGJwJXL`
- Mobile Monthly replacement price: `price_1U80wvBFbQoDa6p0gyuJ7ibY`, USD 6.99/month plus the approved regional prices
- Polyglot Permanent product: `prod_V8HMfV6ZjgSsYA`
- Polyglot Permanent price: `price_1U80o0BFbQoDa6p0b8u97nPq`, USD 31.99 plus the approved regional prices
- Premium Lifetime product: `prod_V8B2TQgSmAHShK`
- Premium Lifetime replacement price: `price_1U80jyBFbQoDa6p0RI72ckxu`, USD 59.99 plus the approved regional prices
- The pre-split lifetime price `price_1U7ug9BFbQoDa6p0qrHmdEdq` and original monthly price `price_1U7sgkBFbQoDa6p0nb1vGaSy` remain available for transaction history and existing customers.
- Stripe offered 36 of the 37 requested currencies. KWD was unavailable in the price selector and was not substituted. JPY Monthly is stored as JPY 787 because Stripe treats JPY as zero-decimal.
- Historical-owner coupon: `wonderlang_desktop_owner_lifetime_50`
- Billing Portal is configured.
- Restricted API key and webhook signing secret are not yet created; processing remains disabled.
- A fresh signed-in browser check confirmed that Mobile Monthly is active in Stripe's sandbox, retains the original USD 6.99/month Price for history, and exposes `price_1U80wvBFbQoDa6p0gyuJ7ibY` as the separate "approved regional prices" Price. No live-mode Stripe object was changed.

## Google Play

- Developer organization ID: `6814081401818264265`
- App: `com.wonderlang.app`, Play app ID `4972386637208238631`
- Monthly subscription product: `wonderlangmonthly`, displayed as Mobile Monthly with full-game, cloud-save and Android/iOS benefits
- Unsaved base-plan draft: `monthly`, monthly renewal, USD 6.99, 177 regions. Google computed regional prices, but its automatic conversions do not reproduce the approved regional-discount table.
- Base-plan save returns `Your changes couldn't be saved`; a fresh authorized retry on 2026-08-24 returned the same provider-side failure. The known account prerequisite is unresolved Taiwan and Ireland payments-profile tax information.
- The three-day introductory offer can be created only after the base plan saves.
- `wonderlangfull` is displayed as Polyglot Permanent Access with a no-cloud-save description. Its legacy-compatible `buy` purchase option remains active at its original United States price of USD 25.99 for the currently released app.
- Promo-code campaign `PR Code` (`120231895`) is paused. Its two historical redemptions remain recorded; additional redemptions are disabled.
- A second, non-legacy purchase option is saved as a draft: `buy-polyglot-permanent`, USD 31.99 base with Google-managed localized equivalents across 173 countries/regions. It has not been activated. The Android Billing 9 build explicitly selects this option by `purchaseOptionId` and will not silently fall back to `buy`.
- A fresh signed-in browser check confirmed the intended live/draft split: `buy` remains Active, `buy-polyglot-permanent` remains Draft, and the latter has not been activated ahead of the matching app update.
- The immutable historical `PR Code` campaign still references `wonderlangfull` because two codes were previously redeemed, but its current status is Paused and the only available action is `Resume promotion`; no additional redemptions are enabled.
- `wonderlangch1` through `wonderlangch4` remain restorable; chapter offers remain hidden from new-sale UI.
- The authoritative Android project matches the tested mirror for Billing, `MainActivity`, `WonderLangAccountManager`, manifest, plugin registration and build configuration. On 2026-08-25 only the updated `WonderLangAccountCloudSync.js` was synchronized; the source/target SHA-256 is `0AE61A73539E594E319CDCF8E59DF8065D07DABFD43BAA380F3986DF6C98FE65`. Both Android/editable storefront files and both account/cloud-save files pass JavaScript syntax checks, and `:app:compileDebugKotlin` completes successfully.

## Apple

- Team ID: `8L2M38663F`
- App Store app ID: `6780447024`
- Bundle ID: `com.wonderlang.app`
- Sign in with Apple capability is enabled. Provisioning profiles containing this App ID must be regenerated before the next iOS build.
- Services ID: `com.wonderlang.account`
- Web sign-in domain: `wonderlang-entitlements-9590f.firebaseapp.com`
- Return URL: `https://wonderlang-entitlements-9590f.firebaseapp.com/__/auth/handler`
- Subscription group: `WonderLang Premium`, ID `22331966`
- Monthly product: `wonderlangmonthly`, displayed as Mobile Monthly, Apple ID `6804702003`, one month, USD 6.99 base, all 175 regions
- Introductory offer: free for the first three days, starts 2026-08-24, no end date, all 175 regions
- Polyglot Permanent non-consumable: existing `wonderlangfull`, displayed as Polyglot Permanent Access, Apple ID `6789931887`; its current base price is USD 31.99 across 175 regions with Apple-managed comparable tiers.
- Apple storefront tiers do not exactly reproduce the website/Stripe regional table; the USD 31.99 global price schedule is the saved provider-authoritative catalog.
- Existing `wonderlangch1` through `wonderlangch4` products remain present for restore and server-side migration.
- Sign in with Apple key, App Store Server API key and Notifications V2 secrets remain pending explicit private-key approval.

## Immediate credential-security gate

GitHub secret scanning detected the Firebase Android client key in an earlier public commit. Public `main` history was rewritten without the key, the current tree has regression coverage, and Netlify's `FIREBASE_WEB_API_KEY` is secret-scoped. The historical alert remains open until the Google credential is restricted/rotated. Google Cloud currently requires an account password re-check before that action.

## Unverified release gates

- Real Google, Apple and email-link sign-in against Firebase test credentials
- Stripe test Checkout, Portal and webhook replay
- Play license-tester purchase and backend verification
- Apple Sandbox purchase and App Store Server Notification verification
- Two-installation cloud-save upload/restore/conflict test
- Real authenticated customer/admin browser workflows against the configured Firebase test project
- Real-device Android tap, cancel, scroll and rapid-double-tap Billing matrix
- The deterministic storefront audit still contains a legacy rule requiring all four chapter offers to remain on sale. This conflicts with the approved commercial model in which chapter SKUs are restore-only; do not satisfy that rule by reintroducing chapter sales.

Code complete; real-device Android tap-to-Billing verification is still required before release.
