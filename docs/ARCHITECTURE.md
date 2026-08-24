# Architecture

## Trust boundary

Firebase Auth answers **who is the player**. Stripe, Google Play and Apple answer **what was paid for and whether it remains valid**. Only this backend combines those facts into effective access. Clients never submit an entitlement boolean.

## Write path

1. Verify the provider signature/OIDC/JWS.
2. Claim the provider event by its provider-issued ID in `providerEvents`.
3. Retrieve current provider state where lifecycle ordering can be ambiguous.
4. Upsert a monotonic provider grant in `grants`; a provider transaction/subscription cannot change UID.
5. Recompute `entitlements/{uid}` from all effective grants.
6. Create deduplicated side effects in `outbox`.
7. Return success only after durable state is committed. Real failures return 5xx so the provider retries.

Key allocation, MailerLite, ads and subscription cancellation are not performed inside the provider webhook. This prevents a temporary third-party outage from losing a paid order.

The scheduled reconciliation worker is the second recovery path. It leases one run, finds due monthly subscriptions, performs only provider reads, and feeds current Stripe/Play/App Store state through the same monotonic ledger writers. Healthy subscriptions are checked at most once per 24 hours; individual failures receive exponential retry backoff and do not stop other providers. Expired subscriptions remain eligible for recovery checks for 90 days. The feature is separately fail-closed behind `SUBSCRIPTION_RECONCILIATION_ENABLED`.

Final account deletion clears the linked buyer-email cells from the legacy key Sheet and sends each linked MailerLite subscriber through its GDPR forget endpoint before removing the local coordinates. Both calls are idempotent and run only inside the separately gated deletion outbox worker.

## Entitlement precedence

Premium Lifetime Pass > effective Mobile Monthly > platform-scoped Polyglot Permanent/legacy full ownership > legacy chapter ownership > free.

Mobile Monthly grants Android and iOS access plus cloud save only while active. Polyglot Permanent grants the full game forever on exactly one mobile platform and never grants cloud save. Premium Lifetime grants one selected mobile platform, PC/Mac, cloud save, future content, and eligibility for an audited second-platform grant. Premium checkout records a required Steam-key or direct-download choice and enqueues exactly one deduplicated Polyglot desktop fulfillment through the existing key inventory; delivery remains governed by the fulfillment and outbox kill switches. The deprecated `mobile_full_lifetime` identifier is retained only to grandfather pre-split website ledger rows as Premium.

Desktop Steam/Itch grants are recorded for account history and discount proof, but their capability map deliberately grants no mobile content.

An active monthly grant ends at the provider period end unless a newer provider event extends it. Stripe `past_due` changes to a seven-day grace grant. Google and Apple use their provider-reported grace expiry.

## Main collections

- `users/{uid}`: provider customer link and random store account token.
- `providerEvents/{hash}`: durable idempotency inbox containing event metadata and a payload digest, never the raw provider payload.
- `providerCustomers`, `providerSubscriptions`, `providerTransactions`: uniqueness indexes to UID/grant.
- `providerSecrets/{hash}`: server-only AES-256-GCM ciphertext for Google Play subscription tokens, authenticated to the provider subscription hash and Firebase UID. Key material exists only in Netlify.
- `subscriptionReconciliationRuns`: aggregate run history without purchase tokens or customer identities.
- `grants/{hash}`: normalized provider truth.
- `entitlements/{uid}`: cached projection; APIs also project from current grants/time.
- `legacyOrders`, `legacyDiscountClaims`: verified historical purchases and one-use reservation/redemption.
- `legacyKeys`, `legacyFulfillments`: exclusive key inventory and durable fulfillment result.
- `checkoutContexts`, `subscriptionContexts`: browser attribution captured before Stripe redirect.
- `outbox/{hash}`: leased, retrying external side effects; successful payloads are immediately replaced by a redaction marker.
- `cloudSaves/{uid}/slots/{slot}` and `cloudSaveUploads`: manifests and upload transactions.

Clients are denied direct Firestore/Storage access. Authenticated HTTP endpoints gate reads/writes. Ten-minute signed write URLs target disposable staging objects; finalization verifies SHA-256 and size, then creates an immutable revision object before advancing the manifest.
