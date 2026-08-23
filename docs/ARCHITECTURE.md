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

## Entitlement precedence

`mobile_full_lifetime` > effective `mobile_full_monthly` > legacy mobile full/chapter ownership > free.

Desktop Steam/Itch grants are recorded for account history and discount proof, but their capability map deliberately grants no mobile content.

An active monthly grant ends at the provider period end unless a newer provider event extends it. Stripe `past_due` changes to a seven-day grace grant. Google and Apple use their provider-reported grace expiry.

## Main collections

- `users/{uid}`: provider customer link and random store account token.
- `providerEvents/{hash}`: durable idempotency inbox.
- `providerCustomers`, `providerSubscriptions`, `providerTransactions`: uniqueness indexes to UID/grant.
- `grants/{hash}`: normalized provider truth.
- `entitlements/{uid}`: cached projection; APIs also project from current grants/time.
- `legacyOrders`, `legacyDiscountClaims`: verified historical purchases and one-use reservation/redemption.
- `legacyKeys`, `legacyFulfillments`: exclusive key inventory and durable fulfillment result.
- `checkoutContexts`, `subscriptionContexts`: browser attribution captured before Stripe redirect.
- `outbox/{hash}`: leased, retrying external side effects.
- `cloudSaves/{uid}/slots/{slot}` and `cloudSaveUploads`: manifests and upload transactions.

Clients are denied direct Firestore/Storage access. Authenticated HTTP endpoints gate reads/writes, and cloud files use ten-minute signed URLs.
