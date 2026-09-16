# Account management and subscription handoff

## Implemented

- Premium “Choose later”: signed-in purchase owner selects Android or iOS on the website account. No confirmation popup. The transaction updates the order and active grant together; replaying a payment claim preserves that selection. A second mobile access remains support-managed.
- Admin customer payments include live website guest orders and monthly renewal invoices. Refund preview proves order ownership, labels real-money refunds, and requires an administrator confirmation. Commit rechecks ownership and uses a Stripe idempotency key. Existing test/payment integrations remain isolated.
- Website billing portal explicitly enables cancellation at period end, invoice history and payment-method updates. Configuration is provisioned on first use; no extra manual Dashboard setup is required by the implementation.
- Account API exposes each subscription, not only the highest-priority subscription. Game and website cancellation controls route to Stripe, Google Play, or Apple. A provider page completes cancellation; merely pressing the game button does not cancel immediately.
- WonderlangAccess recognizes current monthly and permanent products plus expiry-checked website account access. Any owned retired chapter grants the full permanent game. No chapter offers were reintroduced.
- The backend retired-chapter migration no longer excludes owners because of the old provisional cutoff. Existing records are upgraded when their purchase is restored/reverified/imported; this release did not run a bulk customer migration.
- Offline monthly access does not outlive the known subscription/grace deadline. Lifetime and permanent access remain permanent. Monthly access never enables cloud saves.
- The cancellation label is manually translated in all 24 live menu sections. New website platform/cancellation wording covers the 20 website locales.

## Local files and backups

Both RMMZ and Android asset copies changed:

- `js/plugins/WonderLangAccountCloudSync.js`
- `js/plugins/WonderlangAccess.js`
- `texts/menu.json`

RMMZ root: `C:/Users/utilisateur/OneDrive/WonderLang/RMMZ/Project1`

Android asset root: `C:/sdk/tools/ContentBuilder/content/Wonderlang4/Wonderlang/app/src/main/assets`

Immediate backups: `C:/Users/utilisateur/OneDrive/WonderLang/RMMZ/Project1/backups/subscription-management-20260916`

No APK/AAB was built or uploaded; the installed Android app needs a new build containing these assets. No Mac/iOS native project was modified.

## Verification boundaries

- Added automated platform ownership/one-time selection, portal ownership, live refund preview/commit/idempotency, invoice-payment ownership, provider routing, and offline expiry tests.
- Actual RMMZ and Android WonderlangAccess scripts pass controlled native/web/expired/reviewer/retired-chapter cases using `scripts/check-game-access.mjs`.
- Both actual plugin pairs have matching hashes. Syntax checks pass. Menu validators confirm only the new key was added, preserving all existing data in both copies.
- Local browser test: direct iOS selection updates the simulated account and removes the chooser without a popup. French cancellation button is visible. This does not prove a real purchase or refund.
- Android audit: 26 checks pass; its requirement that chapter offers be visible conflicts with the owner's explicit retired-chapter policy. Shop and audit were not changed to disguise this difference.

Code complete; real-device Android tap-to-Billing verification is still required before release.

Before release, check on a real device: tap purchase once, cancel and retry, scroll over a CTA without purchasing, rapid double tap, offline/reconnect, restore with and without ownership, completed purchase surviving restart, and nonduplicated analytics. Also check Cancel subscription opens the correct provider, cancellation retains access until expiry, and a retired chapter owner gets full permanent access.

Paid fulfillment, real cancellation/renewal/refund events and Firebase emulator security tests still require their respective execution environments. No real payment, refund, or cancellation was executed in this implementation task.
