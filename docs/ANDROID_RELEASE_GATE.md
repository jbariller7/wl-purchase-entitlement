# Android release gate

Use a real Google Play internal-track install with production-equivalent product configuration.

## Deterministic source audit

- Current duplicate `MainActivity.kt`, packaged `AndroidAssetDownloader.js`, `plugins.js` and Gradle dependencies all contain `wonderlangmonthly` consistently.
- Legacy `wonderlangch1`…`wonderlangch4` and `wonderlangfull` remain in restore/query and ownership code.
- New storefront renders monthly and lifetime; chapter purchase cards are absent by explicit product decision.
- Every `SUBS` purchase path selects a valid offer token and attaches the server account token.
- Subscription access is granted only after `/api/v1/google-play/claim` succeeds.
- Account authentication uses the named `wonderlang-entitlements` secondary Firebase app; the existing default Firebase app remains dedicated to WonderLang Analytics and Crashlytics.
- The Firebase test Android app registers the local debug and WonderLang release SHA-1 certificates. Before Play-track testing, also register the Google Play app-signing SHA-1 certificate.
- Close/Hide and Restore use release-tap handling and remain usable during loading, pending, offline and billing failures.

## Real-device matrix

1. Offline open: existing verified legacy ownership works; checkout is clearly unavailable; Close/Hide works.
2. Signed-out open: sign-in path works and the paywall never traps the user.
3. Google sign-in, Apple OAuth sign-in and email-link sign-in each refresh the same account entitlement.
4. Monthly product details unavailable, partial and ready states; buttons are never falsely active.
5. Monthly successful, user-canceled, pending, declined, interrupted and duplicate callback flows.
6. Restore with no purchases, monthly only, each legacy chapter, legacy full and mixed ownership.
7. App restart and second-device login after purchase; server state restores without relying on local booleans.
8. Play grace, hold, canceled-at-period-end, expired, revoked/refunded and resubscribed states via license testers.
9. Lifetime purchased on website unlocks in the Play build. Existing Stripe subscription cancels only after confirmed lifetime payment.
10. Subscriber lifetime purchase while Play-billed shows store-managed cancellation instructions and does not claim automatic cancellation.
11. Cloud save upload/download/conflict while entitled, then lapse/recovery without deletion.
12. Meta/Firebase analytics: one initial native purchase event as designed; no Meta/TikTok renewal events and no client/server duplicate.

Code complete; real-device Android tap-to-Billing verification is still required before release.
