# Android duplicate billing migration

Reference inspected read-only: the current app uses Billing Library 9.1.0, queries only `INAPP`, acknowledges on-device, grants from a local SKU set, and reports Meta purchases on-device.

Apply these changes only in a duplicate Android branch:

1. Keep `wonderlangch1`…`wonderlangch4` and `wonderlangfull` in the restore/query allowlist. Stop presenting chapter SKUs as new offers; never remove their ownership checks.
2. Add `wonderlangmonthly` to a separate `SUBS_SKUS` set. Query product details and purchases once for `INAPP` and once for `SUBS`; merge the two authoritative snapshots without letting an older response erase a newer callback.
3. For `SUBS`, select an eligible `subscriptionOfferDetails.offerToken` and include it in `ProductDetailsParams` before `launchBillingFlow`.
4. After Firebase sign-in, fetch `/api/v1/store-account-token` and call `BillingFlowParams.Builder.setObfuscatedAccountId(token)`. It is a random UUID, not an email or Firebase UID.
5. Send every `PURCHASED` token to `/api/v1/google-play/claim`. Do not grant the subscription or acknowledge it until that endpoint succeeds. The backend verifies with `purchases.subscriptionsv2.get` or `purchases.productsv2.getproductpurchasev2`, prevents token replay, grants, then acknowledges.
6. Preserve a visible pending state for `PENDING`; never grant it. On restore/onResume, submit both INAPP and SUBS purchases again—the endpoint is idempotent.
7. Make the server entitlement snapshot authoritative for monthly/lifetime access. Merge it with verified legacy local chapters so old customers are never relocked.
8. Do not send Meta/TikTok subscription renewals. Keep the current on-device one-time-purchase analytics only until the server conversion policy is deliberately expanded; otherwise a purchase can be double-counted.
9. Keep Close/Hide/Restore controls release-tap safe. A billing or network error must never trap the WebView paywall.

Gradle additions for account sign-in:

```kotlin
implementation("com.google.firebase:firebase-auth")
implementation("androidx.credentials:credentials:1.5.0")
implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
```

Use Android Credential Manager for Google and Firebase email-link auth. Apple login on Android should use Firebase's OAuth provider flow; do not embed an Apple password form.

Before release, run the matrix in `docs/ANDROID_RELEASE_GATE.md` on a real Play-installed build.
