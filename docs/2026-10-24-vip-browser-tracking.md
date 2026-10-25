# Beyond VIP browser tracking and delivery visibility

Implemented locally on 24 October 2026; not deployed.

## Events

- Campaign page: one PageView per load and InitiateCheckout on either reward list's checkout links. The checkout event describes the US$1 reservation, not the discounted Kickstarter pledge.
- Verified return: Purchase, value 1, currency USD. The server re-fetches and validates the live Stripe payment and private return credential before supplying browser conversion data.
- Browser and CAPI both use `beyond-vip:<Stripe session ID>` and the same Purchase event name for Meta deduplication. Reload/retry attempts retain that ID. A browser call is not treated as confirmed delivery.
- Browser pixel: existing WonderLang pixel 552284573796131. Server conversion metadata must identify that same pixel; a mismatch fails closed in the browser.
- The browser receives a SHA-256 email hash, product/tier ID, genuine fbp/fbc when available, and conversion identifiers. Raw payer email and server-captured IP/UA are not included in the public response.

## Privacy and failure handling

- Existing local measurement opt-out, marketing-consent flag, query opt-out and Global Privacy Control are respected.
- Privacy withdrawal on the return page is saved only after its private credential is verified. Pending VIP CAPI delivery rechecks the stored choice before sending. Already transmitted events cannot be recalled by this change.
- Return credentials are removed from the visible URL before loading Meta. They remain in tab-scoped session storage for reload verification. The return page uses no-referrer and no-store headers.
- Pending, refunded, disputed and historical/untracked payments do not produce browser purchases. Browser conversion metadata is limited to recent payments (24 hours).
- Pixel blocking or loading failures do not block checkout, eligibility confirmation or the Kickstarter redirect. Online/focus can retry with the same event ID.
- CSP permits the required Meta script and event origins on the campaign route. No broad wildcard exception was added.

## Admin

VIP rows and CSV exports include Meta status, event ID, acceptance timestamp, attempt count and supplied matching-field names. New server receipts record events_received, pixel ID and test-event status without keeping raw matching values. Existing completed outbox jobs are recognized as acknowledged because their sender completed only after an events_received=1 response. Missing or expired delivery records are shown as unavailable, not silently labeled successful.

Accepted by Meta means server delivery was acknowledged; it does not establish ad attribution or prove browser delivery. Applying the existing filters refreshes the status. Reads are bounded by the existing paginated admin view; there is no new public polling loop.

## Verification

- TypeScript `tsc --noEmit`: passed.
- 87 focused tests across VIP checkout/verification, browser tracking, privacy attribution, admin exports, conversion senders and outbox read behavior: passed.
- Five intercepted Chromium scenarios: campaign funnel, campaign opt-out, verified return, return opt-out and unpaid return. All passed against the built scripts and configured CSP. Report: `work-audit/vip-browser-tracking-check.json`.
- Browser/network tests did not send actual Meta events or create real Stripe checkouts.
- Bundles rebuilt for the campaign, return page and admin console. Localization source controllers/build hooks were updated so a later language build retains tracking.

After deployment, verify one genuine new reservation in the VIP admin tab and Meta Events Manager. Test mode and live attribution must not be confused. No historical purchases were replayed.
