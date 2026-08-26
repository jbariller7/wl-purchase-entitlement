# Android release gate

Use a real Google Play internal-track install with production-equivalent product configuration.

## Deterministic source audit

- Current duplicate `MainActivity.kt`, packaged `AndroidAssetDownloader.js`, `plugins.js` and Gradle dependencies all contain `wonderlangmonthly` consistently.
- Legacy `wonderlangch1`…`wonderlangch4` and `wonderlangfull` remain in restore/query and ownership code.
- New mobile storefront renders Mobile Monthly and Polyglot Permanent; chapter purchase cards and the website-only Premium Lifetime Pass are absent by explicit product decision.
- Every `SUBS` purchase path selects a valid offer token and attaches the server account token.
- The Polyglot path selects `wonderlangfull` purchase option `buy-polyglot-permanent`, uses its live localized price and offer token, and fails closed instead of falling back to legacy option `buy`.
- Subscription access is granted only after `/api/v1/google-play/claim` succeeds.
- Account authentication uses the named `wonderlang-accounts` secondary Firebase app; the existing default Firebase app remains dedicated to WonderLang Analytics and Crashlytics.
- The named account app installs the Play Integrity App Check provider and sends a best-effort `X-Firebase-AppCheck` token to the Netlify API. Server enforcement remains off until Firebase registration, metrics review and the full client matrix are complete.
- Restarting offline never trusts WebView `localStorage` as an Android entitlement authority. A Firebase-UID-bound AES-GCM lease is encrypted by Android Keystore, contains no Firebase or Play token, rejects clock rollback within the measurable boot session, limits Monthly to seven days and its known paid/grace deadline, and requires permanent/Premium access to revalidate online every 30 days.
- The Firebase test Android app registers the local debug, WonderLang upload/release, and Google Play app-signing SHA-1 and SHA-256 certificates. Upload-signed and Play-signed Google login are ready for device testing; debug Google login remains blocked by the abandoned-project OAuth conflict.
- Close/Hide and Restore use release-tap handling and remain usable during loading, pending, offline and billing failures.

## Real-device matrix

1. Offline open: a verified Monthly lease works only before both its seven-day ceiling and paid/grace deadline; verified permanent/Premium access works only before its 30-day revalidation deadline; checkout is clearly unavailable; Close/Hide works.
2. Signed-out open: sign-in path works and the paywall never traps the user.
3. Google sign-in, Apple OAuth sign-in and email-link sign-in each refresh the same account entitlement.
4. Monthly product details unavailable, partial and ready states; buttons are never falsely active.
5. Monthly successful, user-canceled, pending, declined, interrupted and duplicate callback flows.
6. Restore with no purchases, monthly only, each legacy chapter, legacy full and mixed ownership.
7. App restart and second-device login after purchase; server state restores without relying on local booleans.
8. Play grace, hold, canceled-at-period-end, expired, revoked/refunded and resubscribed states via license testers.
9. Premium Lifetime purchased on the website unlocks its selected mobile platform and cloud save. Existing Stripe subscription cancels only after confirmed Premium payment.
10. Subscriber Premium purchase while Play-billed shows store-managed cancellation instructions and does not claim automatic cancellation. A Polyglot Permanent purchase never claims cloud save or subscription cancellation.
11. Cloud save upload/download/conflict while entitled, then lapse/recovery without deletion.
12. Meta/Firebase analytics: one initial native purchase event as designed; no Meta/TikTok renewal events and no client/server duplicate.
13. Change Android accounts while offline and verify the previous account's encrypted lease grants nothing. Advance the clock within one boot session and verify rollback is rejected. Let each lease expire while the app remains open and verify only access disappears—the signed-in identity remains visible.

Code complete; real-device Android tap-to-Billing verification is still required before release.
