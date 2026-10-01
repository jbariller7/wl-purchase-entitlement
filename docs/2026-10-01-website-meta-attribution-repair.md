# Website Meta attribution investigation — 1 October 2026

## Production evidence

Read-only Firestore audit for 30 September in Europe/Paris found five website orders: two Polyglot, one Android permanent, one Lifetime Pass, and one single-language order. All five matching Meta outbox jobs completed on the first attempt, within roughly a minute of payment. The worker only completes those jobs after Meta acknowledges `events_received: 1`.

None of these five checkout records contained `fbc`; two contained `fbp`, three had neither. All carried the browser user agent and IP address. This proves missing matching context, but does not establish whether each customer originally arrived with a Facebook click ID or why each particular identifier was absent.

Meta Events Manager, dataset 552284573796131, 30 September: expanded Purchase chart showed five server and three browser events, eight total before interpreting deduplication. Match quality shown: 5.4/10. Ads Manager's zero attributed sales is the user's reported result; event receipt and ad attribution are separate measurements. No domain allow-list was configured in the inspected dataset settings. The correct advertising account is connected.

Inspected current wonderlang.net homepage, all its owned checkout links, its embedded shop, and lp.wonderlang.net. Main purchase buttons use the current shop. The secondary lp site still exposes old direct Stripe links; its editor was signed out and the user directed the investigation to the old comparison pages instead.

Compared wonderlang.net/ti and wonderlang.net/fgkl5656dh at the user's request. The old shop copied existing cookies to direct Stripe links. The old confirmation page sent an unverified Purchase from wonderlang.net after human interaction within 1.5 seconds, with fixed USD 10 and no event ID. The new confirmation is on wonderlang.app, and previously did not restore the marketing site's original Meta cookies. The old confirmation page was closed without interacting with its purchase trigger.

## Repairs

- Initialize the existing Meta Pixel from the main site's embedded-shop script rather than depending on a mouse/touch event outside the iframe. Existing privacy opt-out remains effective.
- Let slow Pixel downloads finish instead of removing them after 1.5 seconds; allow a bounded 4.5-second initialization wait before checkout captures identifiers.
- Accept long genuine Facebook click IDs intact across capture, iframe, checkout, and server reporting. Values exceeding Stripe's metadata limit stay in Firestore checkout context; they are not truncated.
- Restore the original `_fbp` and `_fbc` cookies on the checkout/confirmation origin before Purchase. Never invent a Facebook click ID.
- Preserve recovery in session and local storage, with expiry. New Stripe sessions carry a distinct conversion-only credential in the success URL fragment; this survives lost storage and cannot claim a purchase, reveal its Steam key, or grant access. Remove the fragment before starting third-party scripts.
- Retry browser Purchase with the same Stripe event ID, including after connection/tab recovery. A previous `fbq` call no longer permanently suppresses delivery. Only verified, paid, recent orders qualify; amounts and currencies come from Stripe.
- Record verification and browser pixel handoff/unavailability timestamps on the checkout request. `handed_off` explicitly does not mean Meta acknowledged browser receipt.
- Preserve explicit checkout opt-out in server and browser reporting. A fresh genuine click or newly available browser ID starts a new checkout attempt instead of reusing frozen, incomplete context.

Normal shop offers, public sales, newsletter discount links, mobile entitlement website purchases, and demo links all use this shared checkout path. Native Google Play/iOS and Steam PDF/first-launch reporting are unchanged by this website repair.

These changes cannot recreate identifiers never captured for historical orders, bypass browser privacy settings, or guarantee Meta will attribute every received Purchase to an ad. No historical conversions were fabricated or resent with invented identifiers.
