# Historical mobile chapter migration

The chapter-to-full migration cutoff is `2026-08-24T23:59:59.999Z`. This captures the existing chapter customers identified before the migration while preventing a chapter SKU sold after the cutoff from unlocking the whole game.

A verified historical chapter receipt creates two deterministic ledger records:

1. The original `legacy_chapter_N` purchase, preserving provider, product, transaction, purchase time, and raw provider-event source.
2. A derived `mobile_polyglot_permanent` grant with transaction ID `chapter-full-upgrade:<original transaction>`, migration metadata, the original mobile platform, and the same provider state.

Replaying a restore or webhook rewrites the same stable records rather than creating or reporting another migration. A refund, revocation, or Google Play voided-purchase notification updates both the original and derived records. A post-cutoff chapter receipt retains only its original chapter access and does not receive permanent full-game access. The migration gift does not include cloud save, PC/Mac, future content, or second-platform eligibility.

The retired chapter SKUs remain in Android restore queries forever but are not displayed for new sales. The cutoff should be changed only through a reviewed release because changing it alters a customer-ownership rule.
