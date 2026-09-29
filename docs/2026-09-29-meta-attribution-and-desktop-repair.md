# Meta checkout attribution and desktop proxies — 29 September 2026

## Scope

The owner explicitly requested retaining original click/browser identifiers,
repairing the Steam PDF Purchase proxy, and restoring the full-game first-launch
conversion. The legacy Stripe handler is excluded at the owner's request.

## Website

- Existing genuine fbc/fbp values now persist in first-party local storage for
  up to 90 days since capture, across tabs and return visits; existing session
  caches migrate. GPC and explicit marketing opt-out clear both caches.
- The original marketing browser ID survives a different checkout-domain cookie.
  Incoming explicit context wins; older cookies cannot replace a newer click,
  and the same click retains its original timestamp.
- The existing embed.js on wonderlang.net includes landing capture and forwards
  attribution into the shop iframe and direct shop links. No MailerLite page
  edit is required for the current homepage.
- Direct wonderlang.app shop/campaign links initialize the existing Meta Pixel
  to obtain a real browser cookie. Checkout waits at most 1.5 seconds for that
  initialization; blockers do not prevent checkout. No Purchase fires here.
- The standalone /shop/landing-attribution.js can be included on marketing pages
  without the shop embed. Such other pages were not edited in this task.
- Existing checkout attempts remain immutable for Stripe idempotency. Previously
  paid purchases with missing identifiers cannot be repaired by inventing IDs.

## Desktop plugin

- PDF hashing uses Node crypto in NW.js, avoiding dependence on secure-context
  Web Crypto. Only the normalized email hash is retained in the conversion queue.
- Browser and durable server delivery have separate state. A failed server call
  no longer prevents the browser fallback; a blocked Pixel is not marked sent.
- Server retries start at 30 seconds and back off to 5 minutes; online/focus
  retries immediately. Pixel retries run every 15 seconds after server acceptance.
- Both channels use steam-bonus-v1:<email hash>. The server keeps lifetime claim
  deduplication and suppresses old browser repeats outside its 24-hour window.
- First full-game launch once per installation again queues Purchase, value 0,
  conversion_kind desktop_first_launch_proxy, ID desktop-launch-v1:<random UUID>.
  Existing saves still honor the configured skipIfSaveExists setting. Demo trial
  tracking retains its separate old flag. Android/iOS remain excluded from this
  desktop plugin; their native verified purchase reporting is not changed.
- Both proxies are estimates, not verified Steam receipts. A player who first
  opens the full game and later claims PDFs can produce two separate proxies.
  Each proxy's retries/browser-server copies share a stable ID.
- Browser state means handed to the loaded Pixel, not Meta receipt proof. Server
  acceptance means persisted to the existing retrying outbox; its worker completes
  only after Meta acknowledges events_received=1.

## Verification / release boundary

Regression coverage includes missing Web Crypto, blocked Pixel, server failure,
reconnect, repeated/restarted launches, mobile exclusion, cache expiry/opt-out,
cross-domain IDs, direct shop initialization and normal discounted checkout.
No synthetic production Purchase was sent during verification.

The website/backend deployment takes effect independently. Updated desktop
plugin files in build folders require the owner to publish a Steam build before
existing players receive them. No live Steam release or new Android binary is
published by this task. Native Billing UI and entitlement code were not changed.
