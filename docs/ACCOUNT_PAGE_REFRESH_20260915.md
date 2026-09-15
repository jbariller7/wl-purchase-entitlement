# Account page refresh — 15 September 2026

## Implemented

- Supplied WonderLang logo and responsive purple, yellow and orange account theme.
- Lifetime and permanent-mobile labels in the subscription summary.
- Second mobile access described as two Android, two iOS or one of each.
- Second-access action opens an addressed email to wonderlang.thegame@gmail.com. It does not send the email or grant access automatically. Existing pending-request cancellation remains available.
- Removed the historical Stripe checkout-ID claim form and its event bindings.
- Replaced obsolete slotCount rendering with the actual profileCount API field.
- Read-only profile cards with each profile's cloud-sync time, save slots, game-save timestamps and play time. Missing metadata is shown as unavailable, not invented.
- New authenticated profile-summary endpoint. Old backup bundles are integrity-checked; only slot metadata is returned. Future finalized uploads/restores retain summary metadata to avoid downloading whole bundles for this page.
- Empty profiles no longer create a false last-cloud-sync date in the account summary.
- Profile requests are limited to two concurrent reads and cannot render after switching accounts.
- Account deletion preview/commit now reject when outbox or deletion processing is disabled, before disabling the user. In that configuration the page opens an explicit support email instead. No deployment controls were enabled.
- Escaped security-dialog copy and confirmation phrases.
- Language selector with 41 manually authored summary/profile strings in 20 language/region choices. Profile names and account identifiers are not translated.

## Validation

- TypeScript check passed.
- 63 profile, restore, route, configuration and erasure regression tests passed.
- 5 additional UI/email/deletion-gate/translation-structure tests passed.
- Real browser, local side-effect-free demo: logo/theme, lifetime label, two profiles including an empty profile, save table, French language switching, invalid deletion confirmation and cancel.
- No real account deletion, production payment, entitlement grant or cloud-save overwrite was performed.

## Not complete / not claimed verified

- Full account-site localization is **not complete**. Billing offer copy, login/security dialogs, dynamic errors/status messages and some accessible labels remain English. Current structural translation checks do not prove full linguistic or UI coverage.
- No real cloud account was deleted to test final scheduled erasure. Production end-to-end deletion and worker operation remain unverified.
- Same-platform second access is a support/email fulfillment process, not a new automatic entitlement model.
- Live deployment status must be checked separately; this file is not deployment confirmation.

Original widget, API and profile-service backups are in Project1/backups/20260915-web-account.
