# Beyond VIP Meta Purchase reporting

New checkout attempts created after this release opt into the versioned reporting pipeline, unless the visitor has opted out. Historical reservations are not backfilled.

After authoritative Stripe validation, the same Firestore transaction records the reservation and creates one durable meta_conversion outbox job. Its key and Meta event ID are stable per checkout session. A persistent reservation marker prevents re-creation after outbox retention cleanup.

- Event: Purchase; value: 1; currency: USD (verified original price, including when Stripe charges a local equivalent).
- Product: WonderLang_Beyond_VIP_<tier>; conversion_kind: beyond_vip_reservation.
- Source URL: https://wonderlang.app/beyondmockup/ (no return token or email in URL).
- Event time: Stripe charge creation timestamp, with a session timestamp fallback; events older than seven days are not newly queued.
- Matching: hashed normalized checkout email, bounded genuine fbc/fbp identifiers, trusted connection IP and browser user agent.
- GPC and existing WonderLang marketing opt-outs suppress reporting.
- Delivery: existing Meta CAPI sender and scheduled outbox worker, with retries and stable IDs. No browser Purchase is fired.
- Pending/unpaid, invalid, refunded and disputed sessions do not newly enqueue a Purchase. A later refund does not erase an already delivered historical Purchase.
- The browser uses existing attribution utilities to preserve ad clicks through all 22 VIP reward links; it does not invent click IDs.

Validation: production build and TypeScript check passed; 55 focused tests passed. Public live health confirms AD_CONVERSIONS_ENABLED and adDelivery configuration. No real or fabricated payment was made; receipt by Meta for this new product remains to be checked on the first real purchase. The implementation does not change payment amounts, fulfillment, secrets, or feature flags.
