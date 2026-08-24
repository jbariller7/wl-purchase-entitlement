# Staging provider status

Last verified: 2026-08-24. This file records only non-secret identifiers and safety state.

## Safety state

- Netlify site: `wl-purchase-entitlement.netlify.app`
- Firebase test project: `wonderlang-entitlements-9590f`
- Stripe is test mode only.
- Apple purchases are `Prepare for Submission` / Sandbox configuration.
- All fulfillment, advertising, webhook-processing, cancellation, deletion-processing, outbox and Stripe-mutation switches remain disabled.
- Secret material is stored only in Netlify secret-scoped variables or ignored local build configuration. Never add values to this file.

## Firebase

- Firestore default database: Standard edition, `europe-west9`, client rules deny all.
- Authentication providers enabled: Email/Password and Google.
- Apple provider is pending its private-key configuration.
- Android app: package `com.wonderlang.app`, Firebase app ID `1:769128191668:android:211c0685b2f5ee016d69e1`.
- Debug, upload and Play App Signing SHA-1 certificates are registered.
- Storage is pending a separately approved Blaze billing upgrade.
- The Android Firebase client key is injected from `WONDERLANG_ENTITLEMENTS_FIREBASE_API_KEY` in ignored `local.properties` or the Android build environment. It is not tracked in Git.

## Stripe test catalog

- Monthly product: `prod_V88ycRQwGJwJXL`
- Existing monthly price: `price_1U7sgkBFbQoDa6p0nb1vGaSy`, USD 6.99/month, USD only
- Pre-split lifetime product: `prod_V8B2TQgSmAHShK`
- Pre-split lifetime price: `price_1U7ug9BFbQoDa6p0qrHmdEdq`, USD 60.00
- The three replacement multi-currency Prices (Monthly USD 6.99, Polyglot USD 31.99 and Premium USD 59.99) are implemented in code but not yet created/saved in Stripe.
- Historical-owner coupon: `wonderlang_desktop_owner_lifetime_50`
- Billing Portal is configured.
- Restricted API key and webhook signing secret are not yet created; processing remains disabled.

## Google Play

- Developer organization ID: `6814081401818264265`
- App: `com.wonderlang.app`, Play app ID `4972386637208238631`
- Monthly subscription product: `wonderlangmonthly`
- Unsaved base-plan draft: `monthly`, monthly renewal, USD 6.99, 177 regions
- Base-plan save is blocked by unresolved Taiwan and Ireland payments-profile tax information.
- The three-day introductory offer can be created only after the base plan saves.
- `wonderlangfull` is the Polyglot Permanent product. Its currently saved United States price is USD 25.99; the USD 31.99 price change is prepared but not saved.
- `wonderlangch1` through `wonderlangch4` remain restorable; chapter offers remain hidden from new-sale UI.

## Apple

- Team ID: `8L2M38663F`
- App Store app ID: `6780447024`
- Bundle ID: `com.wonderlang.app`
- Sign in with Apple capability is enabled. Provisioning profiles containing this App ID must be regenerated before the next iOS build.
- Services ID: `com.wonderlang.account`
- Web sign-in domain: `wonderlang-entitlements-9590f.firebaseapp.com`
- Return URL: `https://wonderlang-entitlements-9590f.firebaseapp.com/__/auth/handler`
- Subscription group: `WonderLang Premium`, ID `22331966`
- Monthly product: `wonderlangmonthly`, Apple ID `6804702003`, one month, USD 6.99 base, all 175 regions
- Introductory offer: free for the first three days, starts 2026-08-24, no end date, all 175 regions
- Polyglot Permanent non-consumable: existing `wonderlangfull`, Apple ID `6789931887`; its currently saved base price is USD 59.99 across 175 regions. The USD 31.99 price change and Polyglot naming are prepared but not saved.
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
- Real-device Android tap, cancel, scroll and rapid-double-tap Billing matrix

Code complete; real-device Android tap-to-Billing verification is still required before release.
