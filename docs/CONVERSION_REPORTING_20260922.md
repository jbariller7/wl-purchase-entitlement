# Conversion reporting repair — 22 September 2026

## Current commercial model

Individual chapter purchases are retired. Keep them hidden and preserve historical entitlements/restores. Mobile offers are monthly subscription and permanent full-game access. Never reintroduce chapters to satisfy an old release audit.

## Reporting ownership

| Source | Event | Stable identity | Delivery |
| --- | --- | --- | --- |
| New website single/polyglot/premium/permanent mobile payment | Purchase with actual paid amount | Stripe Checkout session ID | Browser Pixel and durable Meta/TikTok server outbox |
| Website subscription trial | StartTrial, zero value | Checkout session ID | Existing server outbox |
| First paid website subscription invoice | Subscribe with actual payment | Invoice ID | Existing server outbox; later renewals are not acquisition conversions |
| Steam desktop PDF claim | Purchase, zero value, `conversion_kind=steam_pdf_proxy` | `steam-bonus-v1:` + SHA256(trimmed lowercase email) | Durable Meta outbox plus browser Pixel with the same event ID |
| Native Android | Purchase / StartTrial / Subscribe | Verified backend conversion ID; local SDK dedup ledger | Existing native SDK; now retries a temporarily unavailable verified amount |
| Native iOS | Must be implemented/verified on the Mac | Verified transaction identity | See Mac handoff; Windows changes do not complete this |

The Steam event remains an explicitly requested proxy, not a verified Steam receipt. A different email can still create another proxy. The same person can also buy on the website and request PDFs in a Steam-key edition; without a linked Steam receipt those cannot safely be assumed to be the same purchase. No historical claims or launches were backfilled as new purchases.

New website checkouts carry `wl_ads_owner=entitlement-v2`. Deploy the legacy `wonderlang-keys` guard first; it skips its advertising calls only for this marker. Old desktop checkout sessions remain legacy-owned. Key allocation and email delivery are unchanged. The new server conversion enqueue is independent of legacy key availability.

The website embed carries available original fbp/fbc and genuine fbclid across the marketing-site iframe boundary. The server uses the checkout request IP and user agent. No invented click IDs, fake revenue, raw purchase tokens, or browser secrets are added. Website completion emits a browser Purchase only after verifying a live, paid session and its browser-held claim secret. Reloads reuse the same transaction ID and a local queued marker. Old completion pages stop emitting browser Purchase after 24 hours; server reporting is unchanged.

Steam requests store only an email hash in the client retry record. A Firestore transaction creates the lifetime dedup record and outbox job atomically. Repeat requests within 24 hours may retry the browser event with the same ID; later repeats do not emit a new browser event. The outbox retains its dedup key after successful delivery. If the server request fails, the desktop plugin retries while running, after reopening, and on reconnect. The separate fixed-$10 full-game launch Purchase was removed.

Native Android purchase access is still granted before optional analytics enrichment. API responses now distinguish `ready`, `pending`, and `not_applicable`. Pending details retry after 15, 60, 180, and 600 seconds; the existing owned-purchase refresh reclaims on restart. Native local deduplication remains installation-local; this repair does not claim exactly-once delivery across reinstalls. No parallel web CAPI copy of the native SDK Purchase was added.

## Validation and rollout

57 focused tests passed (Steam lifetime dedup, website identity/ownership/attribution, Stripe subscriptions, native purchase identity and sandbox filtering). TypeScript and website asset build passed. The updated Android audit passes 29 checks and rejects the original click-only regression. JavaScript syntax checks pass. Android `:app:compileDebugKotlin` passed. The initial Gradle loopback failure was resolved using the existing short Java temporary directory (`C:\sdk\wl-java-tmp`) through process-local Java options.

Release gates: upload updated Steam builds, build/test/release Android, and implement/test iOS on Mac. No production fake purchases were sent. Verify the next real paid order's browser/server ID and the corresponding outbox acknowledgement. Observe coverage over new traffic, not the historical 7-day figure. Pixel coverage is not the percentage of all business sales matched to an ad; it cannot measure Steam buyers who never claim PDFs.

Test native subscription and permanent CTAs separately, cancellation/retry, scrolling, rapid double taps, offline/reconnect, restores (including legacy chapters), completed sandbox purchase/restart, and nonduplicated analytics. Keep sandbox payments out of production Purchase reporting.
