# Compute reductions and deployment review

Status: Deployment authorized on 23 October 2026, together with the Beyond preview update and confirmed July 2027 release target. Live verification follows the Git-triggered deployment. No queues or payment records were modified.

## Implemented

- Public discount responses use Netlify durable CDN caching for up to 1,800 seconds, shortened to the earliest scheduled campaign expiry. Query variants include `placement` and `id`. Errors and non-GET responses remain uncacheable. Private checkout, account and entitlement responses remain uncached.
- Browser responses require revalidation, so browser and CDN lifetimes cannot stack into an additional thirty minutes. The shop scheduler subtracts the response Age from the remaining cache lifetime.
- Shop network refreshes are normally thirty minutes apart. Focus events do not bypass freshness; concurrent requests coalesce; hidden/offline pages skip refreshes; failures back off. The existing one-second on-screen sale expiry/countdown remains in place.
- Public multi-offer sales read each distinct campaign once, in parallel, rather than reading the same document repeatedly for every offer.
- Outbox jobs visibly not due or still leased skip unnecessary transactions. Atomic eligibility checks and leases remain authoritative.
- Contact forwarding checks every five minutes instead of every minute (80% fewer scheduled invocations). A newly submitted contact remains saved immediately; forwarding may take up to five minutes, plus retry time on failure.
- VIP reconciliation checks every thirty minutes instead of ten (67% fewer scheduled invocations). Stripe webhooks and the return-page payment verification remain immediate. Recovery after missed callbacks may take up to thirty minutes.
- Setup status auto-refresh changes from fifteen seconds to five minutes while visible/online (95% fewer periodic requests). Manual Refresh remains available.
- Generated shop and setup browser bundles rebuilt locally.

Order outbox processing remains every minute, preserving delivery/fulfillment latency. Discount checkout expiry remains every minute: Stripe's minimum session lifetime means this worker is required to enforce shorter campaign deadlines. Cloud-save cleanup and sign-in expiry/security checks are unchanged. No payment authority, authentication or rate-limit rules were weakened. Existing media and video quality are unchanged.

Manual sale changes may take up to thirty minutes to appear publicly. Checkout still validates the current campaign against Firestore and rejects withdrawn/expired offers. Scheduled expiry shortens the cache lifetime and the browser also removes expired offers. Actual CDN HIT behavior requires verification after an authorized deployment; local tests cannot prove Netlify edge behavior.

## Failed-request investigation (read-only, 23 October)

The observed hour around 08:17–09:17 Paris time showed:

- Steam conversion reporting: 36 requests, all HTTP 403. Individual requests reached the function and returned JSON. The handler has an origin allowlist rejection before data access. Function logs contain duration entries rather than the rejected Origin. Therefore the rejection path is identified, but the exact disallowed Origin is not established. The desktop reporting code retries unsuccessful reports with backoff capped at five minutes, and focus/online events reset retry timing; this explains how a persistent rejection can recur. Do not broaden the allowlist without identifying the intended client origin. Next step: privacy-limited origin diagnostics or reproduce using the affected desktop build, then fix the exact legitimate-origin mismatch and honor terminal responses/Retry-After in that client.
- Google Play: 47 requests, all HTTP 503 at `/webhooks/google-play`. The public health response explicitly reports `GOOGLE_PLAY_WEBHOOKS_ENABLED: false`. The disabled handler deliberately rejects real notifications so Pub/Sub can retry instead of acknowledging unprocessed purchases/refunds. No setting was enabled and no messages acknowledged/discarded. Resolve the intended operating mode before deployment: validate and enable processing if this endpoint should own RTDN, or configure retained redelivery appropriately if deliberately paused. Returning success merely to stop retries would lose notifications.

The same health response reports the general environment as `test`, with several processing controls disabled. This is an operational configuration observation, not authorization to activate them. Website Stripe processing has its separate handlers; do not infer that all web payments are disabled.

## Validation

- TypeScript no-emit check and local production build passed.
- Thirty focused tests passed: cache deadlines and public-field filtering, non-cacheable errors, scheduling/focus/hidden/offline/concurrency/backoff, unchanged Buy navigation on sale-service failure, campaign deduplication, checkout campaign rules, and atomic outbox behavior.
- The first full run passed 697 tests with 15 skipped, and exposed three VM test-harness failures plus two existing website-link contract failures. The harness now loads the actual refresh module and its three tests pass.
- The two existing failures are in `integration-config.test.ts` and `ui-route-contract.test.ts`: they expect `href="https://wonderlang.net/"` in the account widget. Those tests and their account-widget input were byte-equivalent to HEAD after newline normalization and were not edited. Do not change the production account link solely to satisfy stale expectations.
- Final full run: **702 passed, 15 skipped, 2 existing failures** across 107 test files. All newly added tests and updated shop navigation tests passed. TypeScript passed as the first stage of `npm run check`.
- Full logs are in the parent project's `work/beyondmockup/compute-optimization-*.log` files.

## Deployment follow-up

Batch these changes into one production deployment only after explicit authorization. Check repeated public-discount GET responses for an Age/cache HIT, confirm campaign-ID isolation, try a scheduled short expiry in a non-production environment, confirm current server-side checkout validation, and compare seven-day compute/request totals. Savings are estimates until measured; schedules and client polling reductions above are arithmetic, not measured billing reductions.
