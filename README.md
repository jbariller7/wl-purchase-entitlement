# WonderLang purchase, account, entitlement and cloud-save service

Self-hosted replacement for RevenueCat-style functionality. Stripe, Google Play and Apple remain the payment processors; WonderLang owns the account model, ledger, entitlement projection, fulfillment, ad policy and cloud saves. There is no revenue-share SaaS.

## Commercial contract implemented

- **Mobile Monthly:** USD 6.99/month with a three-day trial, full mobile access on Android and iOS, and cloud save while the subscription is effective.
- **Polyglot Permanent Access:** USD 31.99 once, full game forever on exactly one selected mobile platform (Android or iOS), without cloud save. The existing Apple/Google "wonderlangfull" product maps to this offer.
- **Premium Lifetime Pass:** USD 59.99 once, one selected mobile platform, one PC/Mac delivery choice (Steam key or direct download), cross-platform cloud save, future sequels/additional content, and eligibility for an audited second-mobile-platform request.
- New chapter-by-chapter sales are retired. Historical chapter and "wonderlangfull" purchases remain restorable forever; a historical chapter owner receives Polyglot Permanent on the purchase platform while the original chapter transaction remains in the ledger.
- Cloud save is enabled only for effective Mobile Monthly or Premium Lifetime access. Lapsed access never deletes stored saves.
- Stripe payment failure gets seven days of access grace.
- Subscription renewals never enqueue Meta or TikTok conversion events.
- A verified historical website Steam/Itch buyer gets one private, single-use 50% Premium Lifetime checkout. The old purchase does not itself grant mobile access.
- A Stripe subscriber buying Premium Lifetime must explicitly confirm cancellation. Premium is granted first; cancellation is then performed by a retrying job. Buying Polyglot Permanent never cancels a subscription. Apple/Google subscriptions remain store-managed and are never falsely reported as canceled by the website.

## What is implemented

- Firebase Auth ID-token verification and account-bound Stripe customers.
- Google, Apple and passwordless email-link website sign-in widget.
- Responsive `/admin/` operations console with customer lookup, manual grants, two-step refunds and price changes, dry-run imports, delivery retries, key inventory and audit history.
- Server-verified, email-verified Firebase `admin` custom claims; signing in with Google or Apple alone never grants operations access.
- Fail-closed test deployment controls. Test mode rejects every non-`sk_test_` Stripe key and all side-effect switches default to off.
- Append-only provider event inbox, replay protection, stale-claim recovery and out-of-order grant protection.
- Effective entitlement projector with Stripe, Play, App Store and legacy ownership sources.
- Stripe Checkout, Billing Portal, lifecycle webhooks, refunds/disputes, seven-day grace and conversion policy.
- Google Play Developer API verification, backend acknowledgment, OIDC-authenticated RTDN and token replay prevention.
- Apple official JWS verification for StoreKit 2 and App Store Server Notifications V2.
- Transactional legacy key allocation with retryable Google Sheets and MailerLite mirroring.
- Meta/TikTok server conversion outbox with real checkout attribution and stable event IDs.
- Versioned SHA-256-verified cloud saves using short-lived signed URLs and conflict detection.
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
- `netlify/functions`: account API, provider webhooks and scheduled outbox worker.
- `integrations`: website widget plus clean-room game/mobile adapters.
- `src/admin`: audited admin workflows and two-step financial confirmations.
- `src/catalog`: versioned current prices with immutable Stripe Price history.
- `docs`: deployment, migration, security and release gates.

Start with `docs/IMPLEMENTATION_PLAN.md`; production rollout order matters because the old and new Stripe fulfillment webhooks must never allocate keys in parallel.

The Netlify test site is `https://wl-purchase-entitlement.netlify.app`. Keep every `*_ENABLED` switch false until separate Firebase test and Stripe test credentials are installed and the corresponding workflow is being exercised intentionally.
