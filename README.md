# WonderLang purchase, account, entitlement and cloud-save service

Self-hosted replacement for RevenueCat-style functionality. Stripe, Google Play and Apple remain the payment processors; WonderLang owns the account model, ledger, entitlement projection, fulfillment, ad policy and cloud saves. There is no revenue-share SaaS.

## Commercial contract implemented

- **Mobile Monthly:** USD 6.99/month with a three-day trial, full mobile access on Android and iOS, and cloud save while the subscription is effective.
- **Polyglot Permanent Access:** USD 31.99 once, full game forever on exactly one selected mobile platform (Android or iOS), without cloud save. The existing Apple/Google "wonderlangfull" product maps to this offer.
- **Premium Lifetime Pass:** USD 59.99 once, one selected mobile platform, one PC/Mac delivery choice (Steam key or direct download), cross-platform cloud save, future sequels/additional content, and eligibility for an audited second-mobile-platform request.
- New chapter-by-chapter sales are retired. Historical chapter and "wonderlangfull" purchases remain restorable forever; a historical chapter owner receives Polyglot Permanent on the purchase platform while the original chapter transaction remains in the ledger.
- Cloud save is enabled only for effective Mobile Monthly or Premium Lifetime access. Lapsed access never deletes stored saves.
- Stripe payment failure gets seven days of access grace.
- Historical Stripe trial events remain recognized for existing test/migrated subscribers. New Monthly trials are native Play/App Store purchases; their verified store events drive entitlement and conversion policy.
- A verified historical website Steam/Itch buyer gets one private, single-use 50% Premium Lifetime checkout. The old purchase does not itself grant mobile access.
- Premium Lifetime is the only product sold through website Stripe Checkout. A historical Stripe subscriber buying Premium must explicitly confirm cancellation; Premium is granted first and cancellation is then performed by a retrying job. Native Polyglot purchases never cancel a subscription. Apple/Google subscriptions remain store-managed and are never falsely reported as canceled by the website.

## What is implemented

- Firebase Auth ID-token verification and account-bound Stripe customers.
- Google, Apple and passwordless email-link website sign-in widget with explicit same-account provider linking; email linking refuses to switch or merge accounts.
- Ten-minute PC/Mac device authorization with a separate high-entropy polling secret, explicit customer approval, one-time Firebase custom-token issuance, runtime-only Firebase client configuration, NW.js token exchange/refresh, revocation cleanup and a fail-closed scheduled expiry worker. The actual NW.js end-to-end test remains a release gate.
- Responsive `/account/` customer interface for sign-in/linking, effective access, Premium-only website checkout, native-store purchase guidance, provider-specific subscription management, legacy claims, PC/Mac approval, Premium second-mobile-platform submission/cancellation, session revocation and account deletion.
- Responsive `/admin/` operations console with customer lookup, a Premium second-mobile-platform review queue, audited approval/decline decisions, manual grants, two-step refunds, Premium Stripe price changes, native-store regional price references, dry-run imports, delivery retries, key inventory, provider monitoring and audit history. Explicit `?demo=1` sessions are stateful but fictional and side-effect-free; the normal page never substitutes demo records for unavailable services.
- Server-verified, email-verified Firebase `admin` custom claims; signing in with Google or Apple alone never grants operations access.
- Fail-closed test deployment controls. Test mode accepts only Stripe test credentials (`sk_test_` or least-privilege `rk_test_`) and all side-effect switches default to off.
- Append-only provider event inbox, replay protection, stale-claim recovery and out-of-order grant protection. Apple non-consumables are owned by the stable original transaction ID across restores, receipt claims use Apple's signed chronology, and the ledger atomically rejects a provider purchase claimed by another account.
- Effective entitlement projector with Stripe, Play, App Store and legacy ownership sources.
- Premium-only Stripe Checkout, Billing Portal, historical subscription lifecycle webhooks, refunds/disputes, seven-day grace and conversion policy.
- Google Play Developer API verification, backend acknowledgment, OIDC-authenticated RTDN and token replay prevention. Subscriptions-center resubscriptions recover ownership only through the prior obfuscated account or stored purchase-token link, and final account deletion disables those links for new-purchase attribution.
- Apple official JWS verification for StoreKit 2 and App Store Server Notifications V2.
- Scheduled Stripe, Google Play and Apple subscription reconciliation, with an exclusive lease, per-subscription retry backoff and an operations-console run history. Provider access is read-only; Google Play bearer tokens are AES-256-GCM encrypted with a rotatable Netlify-only key ring.
- Transactional legacy key allocation with retryable Google Sheets and MailerLite mirroring.
- Meta/TikTok server conversion outbox with real checkout attribution, stable event IDs, pre-storage email hashing, and correct zero-decimal currency values.
- Versioned SHA-256-verified cloud saves using 21 fixed RPG Maker slots, short-lived staging URLs, immutable finalized revisions and conflict detection. Each slot retains the current save plus three prior revisions; pruned objects enter a leased, retrying cleanup queue.
- Daily aggregate Cloud Storage inventory snapshots with byte/object growth, stale staging-upload detection, threshold alerts and an Admin Operations view. Monitoring and revision cleanup are independently disabled until the staging bucket is provisioned.
- Reviewed RPG Maker, Android and iOS integration sources, including the synchronized mirror used to update the editable RMMZ project and authoritative Android project. The iOS adapter remains a reviewed integration source until the Xcode project is supplied.

## Local verification

```bash
npm install
npm run check
npm run test:rules
npm run build
```

The Rules test starts isolated Firestore and Storage emulators under a demo project ID and proves that unauthenticated, authenticated and client-forged admin contexts are all denied direct access.

Copy `.env.example` to a secure local environment source. Never commit private keys. Deploy the Firestore/Storage deny-by-default rules before exposing an API.

## Repository map

- `src/domain`: commercial rules and pure entitlement projection.
- `src/providers`: Stripe, Google Play and Apple verification/lifecycle code.
- `src/infrastructure`: Firebase initialization, durable ledger, inbox and outbox.
- `src/cloud-save`: upload integrity, revisions and conflict control.
- `src/legacy`: migrated key fulfillment and exact legacy Payment Link routing.
- `netlify/functions`: account API, provider webhooks, scheduled outbox/reconciliation workers and device-code cleanup.
- `integrations`: website widget plus clean-room game/mobile adapters.
- `src/admin`: audited admin workflows and two-step financial confirmations.
- `src/catalog`: versioned current prices with immutable Stripe Price history.
- `docs`: deployment, migration, security and release gates.

Start with `docs/IMPLEMENTATION_PLAN.md`; production rollout order matters because the old and new Stripe fulfillment webhooks must never allocate keys in parallel. `docs/COMPLETION_AUDIT.md` maps every full-goal requirement to current evidence and the remaining staging/release gates.

The Netlify test site is `https://wl-purchase-entitlement.netlify.app`. Keep every `*_ENABLED` switch false until separate Firebase test and Stripe test credentials are installed and the corresponding workflow is being exercised intentionally.
