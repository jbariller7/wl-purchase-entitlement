# Full implementation and rollout plan

## 0. Isolated Netlify test deployment

1. Use the dedicated `wl-purchase-entitlement` Netlify project linked to the matching GitHub repository.
2. Set `APP_ENVIRONMENT=test`. The service refuses a live or unrecognized Stripe secret key in this mode.
3. Use a separate Firebase test project. Do not copy production Firebase Admin credentials because the Firestore collections are intentionally real, not mocked or namespaced.
4. Use Stripe test products, Prices, Coupon and webhook secret. Never copy the production Stripe secret or webhook secret into this project.
5. Initially keep `STRIPE_WEBHOOKS_ENABLED`, `GOOGLE_PLAY_WEBHOOKS_ENABLED`, `APPLE_WEBHOOKS_ENABLED`, `OUTBOX_PROCESSING_ENABLED`, `AD_CONVERSIONS_ENABLED`, `LEGACY_FULFILLMENT_ENABLED`, `SUBSCRIPTION_CANCELLATION_ENABLED`, `SUBSCRIPTION_RECONCILIATION_ENABLED` and `STRIPE_MUTATIONS_ENABLED` set to `false`.
6. Do not copy production Meta/TikTok tokens into staging. Test event codes are not a substitute for isolation when delivery is not under test.
7. The Google Sheets and MailerLite credentials may be added later only for an intentional fulfillment canary, with the outbox and legacy-fulfillment switches still off until the exact test begins.
8. After creating a verified Firebase test user, grant operations access with `npm run admin:set-claim -- --email you@example.com --confirm "SET ADMIN you@example.com"`. The script revokes existing sessions so the new claim cannot be missed by a cached token.

## 1. Provider/account setup

1. Create or select a Firebase project in an EU location. Enable Anonymous (for a later game-first-run flow), Google, Apple and Email Link providers. Add `wonderlang.net`, `www.wonderlang.net` and the Netlify domain as authorized domains.
2. Configure Apple's Services ID/domain/return URL for Firebase web login. Configure the native iOS Sign in with Apple capability separately.
3. Create Stripe test Prices for Mobile Monthly (USD 6.99/month with a three-day trial), Polyglot Permanent Access (USD 31.99 once) and Premium Lifetime Pass (USD 59.99 once), with the approved regional currency options, plus the 50% historical-owner Coupon. Do not create a public promotion code. Put only their IDs in Netlify secrets.
4. Run `npm run validate:catalog` before production to reject an incorrect amount, currency, interval, disabled Price or non-50% Coupon.
5. Enable Stripe Customer Portal cancellation/payment-method features and set its return URL to the account page.

## 2. Infrastructure deployment

1. Deploy `firestore.rules`, `storage.rules` and `firestore.indexes.json`.
2. Configure Firebase service-account, Stripe, key inventory, MailerLite and ad secrets in Netlify. Use environment UI/secrets, never checked-in files.
3. Build and deploy the functions and static widget.
4. Apply `storage.cors.json` to the Firebase Storage bucket. It includes both WonderLang website origins and the isolated Netlify test origin; remove the Netlify origin from the production bucket after staging is retired.
5. Smoke-test `/api/v1/config`; all other API endpoints must reject missing/revoked Firebase tokens.

## 3. Merge the current purchase automation safely

1. Keep the old `wonderlang-keys` endpoint live while preparing; do not edit it in place.
2. Run `npm run import:legacy-keys` without `--commit`. Compare every tab count with Google Sheets.
3. Stop checkout traffic briefly, run the importer with `--commit`, and verify Firestore available/assigned totals.
4. Point the existing Stripe webhook destination to `/webhooks/stripe` with the required event list below. Disable the old destination before resuming traffic. Running both can allocate two keys for one order.
5. Send one Stripe test order for single-language Steam, polyglot Steam, direct/Itch and BOGO. Confirm the Firestore fulfillment, exact Sheet row, MailerLite fields/groups and one Meta/TikTok event per order.
6. On failure, move the webhook destination back to the old function. Firestore writes are additive; do not clear them. Reconcile the canary sessions before retrying migration.

Stripe events:

- `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`
- `invoice.paid`, `invoice.payment_failed`
- `customer.subscription.created`, `.updated`, `.deleted`, `.paused`, `.resumed`
- `charge.refunded`, `charge.dispute.created`

## 4. Website rollout

1. Publish the account widget assets and embed the two tags documented under `integrations/web/account-widget`.
2. Replace every “No subscription” claim on `wonderlang.net` before offering monthly access.
3. Add clear recurring-price, cancellation and seven-day Stripe grace copy. Keep Polyglot Permanent (one mobile platform, no cloud save) visibly distinct from Premium Lifetime (mobile + PC/Mac + cloud + future content). Premium checkout must require both the first mobile platform and the included PC/Mac delivery choice (Steam key or direct download).
4. Test Google, Apple and email-link login in normal/private browser sessions and on iOS/Android browsers.
5. Test a verified legacy receipt, a wrong-email receipt, a reused receipt, two concurrent discounted checkout attempts, expired checkout release and successful single redemption.
6. Test subscriber-to-Premium: unchecked confirmation blocks; successful Premium payment grants first; exactly one selected desktop key/download is queued; Stripe subscription then becomes canceled; duplicate webhook delivery does not allocate or cancel twice. Buying Polyglot Permanent must never cancel the subscription automatically.

## 5. Google Play rollout

1. In the duplicate Android project, add Firebase Auth and the account bridge. Create the `wonderlangmonthly` subscription/base plan at the approved regional prices and keep `wonderlangfull` as the USD 31.99-equivalent Polyglot Permanent one-time product.
2. Configure Play Developer API access for the service account.
3. Create the Pub/Sub topic, grant Google Play publish access, create an authenticated push subscription to `/webhooks/google-play`, and set its exact OIDC audience in `GOOGLE_PLAY_RTDN_AUDIENCE`.
4. Pass the backend UUID through `setObfuscatedAccountId`, verify every purchase on the backend, and acknowledge there.
5. Keep legacy chapter/full SKUs queryable and restorable while removing chapter cards from the new-sale UI.
6. Execute `docs/ANDROID_RELEASE_GATE.md` on an internal Play track. Do not ship from a sideload-only test.

## 6. Apple rollout

1. When the Xcode project is available, integrate the duplicate Swift adapter and Firebase Auth.
2. Create the monthly product and retain `wonderlangfull` as the Polyglot Permanent non-consumable at the approved regional prices. Pass the backend UUID with StoreKit 2 `appAccountToken`.
3. Download Apple G2/G3 root certificates from Apple PKI, base64-encode them into secrets, set the numeric Apple app ID/bundle ID, and configure App Store Server Notifications V2 at `/webhooks/apple`.
4. Test Sandbox in a non-production environment configured with `APPLE_ENVIRONMENT=Sandbox`; production accepts only Production-signed payloads.
5. Validate purchase, pending, renewal, grace, billing retry, expiration, refund/revoke, restore and family-sharing policy.

## 7. Cloud-save rollout

1. Add the duplicate RPG Maker plugin after native Firebase login/token refresh works.
2. Verify local save always completes even if cloud networking fails.
3. Test two devices editing the same base revision; the second finalize must receive 409 and preserve both copies for user choice.
4. Test corrupt/truncated upload and download SHA-256 rejection.
5. Lapse a subscription: local saves still work; cloud API denies access; stored objects remain. Renew and confirm they reappear.
6. Approve the provider-payload retention period and configure its time-based lifecycle before public launch. The user-request account deletion and 30-day recovery workflow is implemented behind separately disabled processing switches. Current cloud-save code retains the current plus three prior manifest revisions; object garbage collection should be scheduled after the chosen retention period.

## 8. Operational gates

- Dashboard failed `providerEvents`, terminal `outbox` jobs, remaining keys per tab, subscription states and cloud storage growth.
- Alert before any key tab reaches its chosen minimum and on any outbox job reaching ten attempts.
- Reconcile Stripe/Play/App Store active subscriptions daily against grants; webhook delivery is the fast path, not the sole source of truth.
- Before reconciliation testing, generate a distinct 32-byte staging key, install only the versioned `PROVIDER_TOKEN_ENCRYPTION_KEYS` JSON in Netlify, and verify the operations-console token counts. During rotation, retain the old and new keys until every encrypted-token count has moved to the new key ID.
- Export/back up Firestore before schema migrations. Never edit grants manually; use an audited admin-grant endpoint/tool with actor, reason and expiry.
- Publish privacy-policy and terms updates for account data, cloud saves, recurring billing and cross-device processing.

## What still requires external access

The current non-secret console state and remaining gates are tracked in `docs/STAGING_PROVIDER_STATUS.md`. Private Firebase, Stripe and Apple credentials still require explicit approval before creation or storage. Play payments-profile tax forms, Firebase Storage billing, the MailerLite-hosted website, a real Xcode project, store sandbox accounts and physical-device testing require their respective account owner or device surface; they are release gates rather than substitutes for entitlement logic.
