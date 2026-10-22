# WonderLang Beyond VIP reservations

Public page: https://wonderlang.app/beyondmockup/
Private records: https://wonderlang.app/admin/ → Beyond VIP

## Offer

Eleven reward tiers; Early Bird removed. Each VIP reward has the normal tier's benefits at exactly 70% of its normal EUR pledge price. The separate US$1 reservation fee is not credited toward that later pledge. Stripe Adaptive Pricing may offer local currency. Checkout shows the exact reservation amount before payment.

Cancellation and a reservation refund can be requested anytime by emailing jonathan@wonderlang.app. No automatic later pledge charge. Optional Kickstarter add-ons retain their separate normal prices. Reservation terms: `/beyondmockup/reservation-terms.html`, version `2026-10-22-v1`.

## Payment and database flow

1. Each tier's reservation link calls `beyond-vip?tier=<server-allowlisted-id>`.
2. Save a private `beyondVipCheckoutAttempts` document before creating or exposing checkout. Store a hash of the private return token, tier/price snapshot, terms version and Stripe session reference.
3. Create a one-time Stripe Checkout Session for exactly US$1, inclusive tax behavior, automatic tax, no coupon, mandatory terms consent, and email collected by Stripe. There is no game entitlement or game-key delivery.
4. The existing signed live notification destination on `purchased-keys-automation` forwards VIP checkout events to `website-stripe-webhook` and returns before game fulfillment. The receiver independently verifies the original signature, then re-reads the canonical Checkout Session and paid charge from Stripe.
5. Save exactly one `beyondVipReservations/<Stripe-session-id>` record per verified payment. Record email, tier, normal/VIP prices, fee and actual presentment currency, Stripe references, accepted terms, and eligibility/refund/dispute state. Retries use the same document, and refunded records cannot be reactivated by a late completion event.
6. Refund and dispute notifications update the same record. The scheduled reconciliation runs every 10 minutes to recover missed paid checkout notifications, including customers who never returned. Active records are rechecked daily; expired and refunded attempts stop polling. No provider payment is initiated by reconciliation.
7. The return page requires a high-entropy token and independently verifies payment; it returns no email or other payer details. Opening the page is never proof of payment.
8. Only after the paid reservation has been verified and saved, show the thank-you message, campaign dates (November 10 to December 10, 2026), and invitation to follow the project on Kickstarter. An eight-second visible countdown redirects to the fixed WonderLang Beyond Kickstarter URL. Buyers can open it immediately or pause the redirect. Pending, failed, refunded, disputed, and unverified requests do not redirect. The page sends no checkout credentials or payer details to Kickstarter (`no-referrer`).

## Administration

The existing verified administrator authentication and App Check boundaries protect `GET /admin-api/v1/beyond-vip` and record refresh. Firestore client rules deny access to all collections, including VIP data. The admin view supports server-side reward-tier, payment-state, and email filters, paginated loading, a Stripe Dashboard payment link, and status refresh. CSV export traverses all pages with the chosen filters, including empty scan pages; it is not limited to displayed records. The bounded scans avoid requiring new Firestore composite indexes. CSV export neutralizes spreadsheet formulas. Secret reward links must be sent later to eligible reservations; this implementation does not send campaign emails or subscribe customers to a newsletter.

Issue requested reservation refunds through Stripe Dashboard. Webhooks then invalidate VIP eligibility. The refresh button and reconciliation also verify the latest Stripe state.

## Verification boundaries

Unit coverage includes fixed pricing, removed tiers, database failure before checkout, consent, unpaid payments, exact source currency amounts, local presentment, tampered metadata/product/quantity, duplicate notifications, refunds, disputes, private return tokens, and missed-webhook recovery. Original fulfillment routing retains its regression tests. No real payment is submitted by development or verification.
