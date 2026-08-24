# Account deletion and retention

WonderLang uses a two-step, recent-login deletion flow. The player first receives a preview, then must type `DELETE MY WONDERLANG ACCOUNT`. A valid Firebase authentication time no older than ten minutes is required for the commit.

Committing immediately disables the Firebase account and revokes every session. A 30-day recovery window follows. An administrator can cancel the scheduled deletion only with a recorded reason; cancellation re-enables the account and revokes any stale sessions again.

After the recovery window, the deletion outbox job runs only when both `OUTBOX_PROCESSING_ENABLED` and `ACCOUNT_DELETION_PROCESSING_ENABLED` are intentionally enabled. It removes Firebase Auth, the customer profile, effective-entitlement cache, cloud-save objects and manifests, pending uploads, checkout attribution context, unclaimed personal import context, and account tokens. Provider/customer/transaction/subscription links and grants are changed to a one-way pseudonymous deleted-account identifier, with grant metadata scrubbed. This prevents receipt replay or accidental reassignment while removing the live account relationship.

The minimized transaction ledger and provider event identifiers are retained for refunds, chargebacks, accounting, fraud prevention, and audit integrity. Raw provider payload retention must be configured as a separate time-based data lifecycle before production because those payloads can contain provider-controlled personal data. The operational retention period should be approved with WonderLang's accountant or privacy counsel before enabling production deletion processing.

Cloud saves are never deleted merely because a subscription expires. They are deleted only after the player explicitly schedules account deletion and the recovery window ends.
