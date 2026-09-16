# Website checkout release — 16 September 2026

## Implemented

- Buy links no longer depend on a readiness fetch or WEBSITE_CHECKOUT_ENABLED flag.
- Guest checkout uses the existing production-only STRIPE_LIVE_SECRET_KEY. Native/test Stripe settings remain unchanged.
- All five approved live prices are registered in website-runtime-prices.live.json and verified for 37 currencies. Only the two missing mobile prices were created; no additional Payment Links.
- Website Monthly includes a three-day card-required trial. Cloud saves remain Premium Lifetime only.
- Version, language, delivery choice and mobile platform are carried as stable server-side Stripe metadata. The server validates configured prices; no account login before payment.
- The existing purchased-keys-automation webhook forwards the original signed website event to the entitlement service. The existing signing secret was copied privately into STRIPE_WEBSITE_WEBHOOK_SECRET, secret and Production only.
- The original automation is the only Steam/Itch allocator for these purchases. The entitlement backend reads assignments from Google Sheets; it never queues a second allocation or desktop conversion.
- Same-tab private purchase recovery and verified-email discovery attach purchases after payment. Claims can verify payment directly with Stripe if a webhook has not arrived yet.
- Account UI displays delivered keys/links and opens an ownership-checked Stripe subscription portal.
- Refund/dispute markers prevent later claims from restoring refunded one-time access. Website subscription reconciliation uses the live client independently of native/test integration.
- Account deletion scrubs website purchase email/recovery secrets and cached keys while retaining a non-reclaimable ownership marker.

## Verification

- 347 regression tests passed; 15 Firebase-emulator tests skipped because no emulator was running.
- Six additional checkout-runtime tests passed, including no duplicate checkout after payment and no second key allocator.
- Four original-automation routing tests passed. Existing payment-link routing is unchanged.
- Published and verified: entitlement backend b2ee91c (Netlify deploy 6aaab803ec790e0008db540b), existing automation 9ce4edc.
- Actual MailerLite page https://wonderlang.net/jsizvg: all five Buy links opened live Stripe checkout. Verified French/EUR: single EUR19.59, desktop Polyglot EUR30.99, Premium EUR59.99, mobile monthly EUR6.49 with three free days, mobile permanent EUR30.99. No payment submitted.
- Existing Stripe destination we_1RzfGfBFbQoDa6p0BsVxPiqZ now listens to the original two checkout events plus five subscription lifecycle events, invoice.paid, invoice.payment_failed, charge.refunded and charge.dispute.created (11 total). URL and signing secret unchanged.
- Deployed checkout readiness returned HTTP200 with enabled:true. Temporary local catalog helper stopped and its in-memory credential cleared.
- No real payment has been made. Paid purchase, receipt, account activation, refund and subscription-lifecycle testing still require an owner-supervised transaction.

## Remaining beyond opening checkout

- Verify website mobile ad attribution and renewal events end to end; existing desktop conversion automation remains responsible for desktop sales.
- Complete self-service first-platform selection after Premium's Choose later option. The second mobile access still uses the agreed support request.
- Adapt/test admin live-refund controls: they still use the original Stripe environment. Use Stripe Dashboard for live refunds meanwhile.
- Complete manual review of every translation, responsive/RTL layouts and the older surrounding MailerLite page copy.

## Embed — existing snippet remains valid

```html
<script src="https://wl-purchase-entitlement.netlify.app/shop/embed.js" defer></script>
```

Sources: integrations/web/shop/, catalog/website-*.json, src/providers/stripe/website-*.ts.

Original automation repository: jbariller7/wonderlang-keys; integration commit 9ce4edc. Original webhook backed up before editing at ../backups/website-checkout-20260916/stripe-webhook.js.
