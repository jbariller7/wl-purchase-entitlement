# Subscription reconciliation runbook

Webhooks remain the fast path. The scheduled worker is an independent recovery path for a webhook that is delayed, dropped, or delivered out of order.

## Safety properties

- `SUBSCRIPTION_RECONCILIATION_ENABLED` defaults to `false` and is independent of every webhook and outbox switch.
- The Netlify function checks hourly to drain due work, but a healthy subscription is scheduled only once per 24 hours.
- One Firestore lease prevents overlapping runs. Each run processes at most 24 subscriptions with a maximum provider concurrency of four.
- Stripe uses subscription retrieval, Google Play uses `subscriptionsv2.get`, and Apple uses Get All Subscription Statuses. The reconciliation path does not acknowledge purchases, cancel subscriptions, refund payments, or mutate provider configuration.
- A failed subscription backs off independently. Other subscriptions and providers continue.
- Expired subscriptions receive recovery checks for 90 days; refunded, revoked, and account-deleted links are not scheduled.

## Google Play token vault

Google Play requires the original purchase token to retrieve current subscription state. The token itself is never used as a Firestore identifier and is never stored in plaintext. The ledger uses `play_<sha256(token)>`; a separate deny-by-default server collection stores AES-256-GCM ciphertext authenticated to that hash and the Firebase UID.

Create a distinct random 32-byte key outside the repository, base64-encode it, and install a key-ring JSON value only as the Netlify secret `PROVIDER_TOKEN_ENCRYPTION_KEYS`:

```json
{"current":"staging-YYYY-MM","keys":{"staging-YYYY-MM":"BASE64_32_BYTE_KEY"}}
```

Never paste an actual key into source, docs, commits, build logs, or support messages.

## Key rotation

1. Add a new key ID and key while retaining the old entry; set `current` to the new ID.
2. Keep reconciliation enabled in the intended environment. Every successful Google Play check rewrites the token under the current key.
3. In Admin → Operations → Provider token vault, wait until the old key ID has zero tokens. Investigate any repeatedly failing subscriptions first.
4. Remove the old entry from the Netlify key ring.

Final account deletion destroys the encrypted token and disables its retained subscription link from further reconciliation.

## Activation test

1. Keep every unrelated side-effect switch off.
2. Install provider sandbox credentials and the staging-only encryption key ring.
3. Create one Stripe test subscription, one Play license-tester subscription, and one Apple Sandbox subscription linked to separate test accounts.
4. Run the worker with reconciliation enabled only in the test deploy.
5. Verify one successful row for each provider in Admin → Operations, unchanged provider-side billing state, and an updated local grant/entitlement projection.
6. Simulate a provider read failure and confirm only that target backs off with a sanitized error.
7. Disable the switch again until the complete release checklist is approved.
