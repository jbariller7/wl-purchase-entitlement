# Meta website purchase reporting repair — 28 September 2026

## Confirmed production failure

The order confirmation page aborted `website-conversion` verification after
2,000 ms. Netlify's retained logs for the seven requests from 27 September
09:18 to 28 September 03:56 (Europe/Paris) show durations of 3,234, 3,138,
3,265, 3,156, 3,181, 3,283 and 3,245 ms. Each exceeded the browser cutoff.
The browser therefore skipped its Purchase even when durable server delivery
completed successfully. This is a confirmed website failure, not a claim that
every unmatched event across Steam, apps and old integrations has this cause.

Stripe's September Newsletter discounted purchases use `website-session-v1`
and `wl_ads_owner=entitlement-v2`, the same server reporting path as normal
checkout. The latest 15 Meta outbox jobs inspected were complete. The sender
only completes a job after Meta acknowledges exactly one event.

## Repair

- Browser verification allows 15 seconds per attempt, with at most three
  attempts for network errors, HTTP 429/5xx or payment processing still pending.
  Rejected ownership is not retried. No new payment or server event is created.
- Pixel loading must succeed before the browser delivery marker is stored.
  Temporary loading failures can retry on a timer, focus or reconnection.
- Concurrent/repeated sends retain the verified Stripe session as `eventID`;
  local guards suppress repeats. The local marker means handed to the loaded
  Pixel, not independently acknowledged by Meta.
- Shop attribution refreshes after late parent-site cookies become available,
  and again before purchase-link navigation. Only real existing identifiers are
  used. Session-scoped context survives reload/cancellation for up to 24 hours;
  GPC and explicit marketing opt-out suppress this capture.
- Shop parent messages still validate both origin and frame identity. Late
  attribution updates do not reset the user's offer selections.

No historical sales were fabricated or resent, no campaign settings were
changed, and the Steam PDF Purchase proxy remains enabled and unchanged.

## Validation and remaining observation

Regression tests cover the measured slow verification, temporary server/network
failure, ownership rejection, blocked Pixel downloads, overlapping retries,
blocked browser storage, opt-out, and attribution continuity. Existing checkout,
discount, server sender and event ownership tests must also pass.

Meta's next real website purchases should show both integrations with the same
event ID. Its coverage figure is a rolling seven-day browser/server metric;
the overall dataset also includes Steam proxies and app SDK events. A successful
API delivery does not guarantee an Ads Manager attribution. No synthetic paid
conversion is appropriate for verifying this repair.

Netlify separately reported 148K monthly function requests and a Free Legacy
allowance warning. Health checks still returned HTTP 200 during this audit.
Plan/billing changes require the owner's decision and are not part of this code
change. If service is paused, queued server jobs need to resume after restoration.
