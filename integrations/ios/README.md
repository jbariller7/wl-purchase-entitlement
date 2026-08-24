# iOS duplicate integration

The iOS project was not available, so no production file was touched. `WonderLangEntitlementStore.swift` is a clean-room StoreKit 2 adapter to place in a duplicate project later.

The adapter currently targets the isolated `https://wl-purchase-entitlement.netlify.app` test service. Replace that constant only as an explicit production-cutover step.

Required integration:

- Add Firebase Auth and enable Sign in with Apple. Use `ASAuthorizationAppleIDProvider` with a SHA-256 nonce, then exchange the Apple credential with Firebase. Never accept an unverified Apple identity token directly in the game.
- Obtain `/api/v1/store-account-token` after Firebase sign-in and pass its UUID through StoreKit's `.appAccountToken(...)` option.
- Send `VerificationResult.jwsRepresentation` to `/api/v1/apple/claim`; only finish the StoreKit transaction after the backend accepts it.
- Configure App Store Server Notifications V2 at `/webhooks/apple` and upload Apple G2/G3 root certificates to Netlify as base64 secrets.
- Continue restoring legacy chapter and `wonderlangfull` transactions even though the new storefront presents Mobile Monthly plus Polyglot Permanent instead of chapter-by-chapter offers. `wonderlangfull` is one-platform permanent access and does not include cloud save.
- For an Apple-billed subscriber buying Premium Lifetime on the website, show the App Store subscription-management link. Apple controls cancellation; the website must not claim it canceled the Apple subscription.

The adapter must be compiled and exercised in the real Xcode project before release.
