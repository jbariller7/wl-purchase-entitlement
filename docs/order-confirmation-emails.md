# Purchase confirmation emails

## Scope

The website checkout and its newsletter discount campaigns use this pipeline for all five current offers: single language PC/Mac, Polyglot PC/Mac, Premium Lifetime, mobile monthly, and mobile permanent. Steam and direct-download deliveries get their already-assigned key/link from the Google Sheets registry. No second key is allocated. Mobile and Premium instructions recommend signing in at https://wonderlang.app/account/ with the purchase email first, then using that same account in the game. Premium explicitly states that iOS is not released yet.

Monthly checkout (including a free trial) gets one confirmation. Subsequent positive paid invoices get separate confirmations keyed by invoice ID. Initial subscription invoices are excluded to avoid a duplicate checkout confirmation. Messages state automatic renewal and account cancellation instructions. The actual paid total, including discounts and taxes, comes from Stripe, never the advertised list price.

Native Google Play / App Store purchases still receive store receipts. They do not use this website order pipeline. Historical payment links without `website-session-v1` retain their existing fulfillment. This is not a newsletter service and does not subscribe purchasers to marketing.

## Language

20 manually authored locales: en, fr, de, es, es-MX, pt-BR, pt-PT, it, nl, sv, pl, uk, ru, id, ko, ja, zh-CN, zh-TW, ar, hy. Checkout language takes priority; billing country is the fallback, then English. An email address is not a reliable language signal. Multilingual countries without a chosen language default to English. HTML and plain text are both included; Arabic uses RTL. Checkout product descriptions are reused with their exact product meaning reviewed.

## Transport and activation

Sender and reply-to: orders@wonderlang.app (existing alias). Authenticated account: jonathan@wonderlang.app. SMTP: smtp-relay.gmail.com, port 587, required STARTTLS, certificate verification enabled. Password: Netlify secret `ORDER_EMAIL_SMTP_PASSWORD`, production deploy context only. The current Netlify plan locks secret scopes to Builds, Functions and Runtime; selecting Functions alone requires an upgrade. The application reads this secret only in server email code and never injects it into browser assets. No secret belongs in Git or chat.

Google Admin routing rule **WonderLang order confirmations**: domain sender addresses only, SMTP authentication required, TLS required. Saved on 2026-09-24. SPF, google DKIM public record and DMARC were present when checked. Owner preview delivery was verified in Gmail on 2026-09-24: sender/reply-to orders@wonderlang.app, mailed by wonderlang.app, signed by wonderlang.app, TLS encryption. The raw SPF/DMARC result headers were not inspected.

Activation sequence:

1. Publish the accompanying `wonderlang-keys` change first. It skips MailerLite only for sessions marked `wl_email_owner=workspace-v1`; its key assignment and conversion behavior are preserved.
2. Deploy this backend with sending off. Create a Google app password through the account owner and save it in Netlify as above.
3. Verify SMTP and send a clearly labelled preview to the owner. Inspect receipt and SPF/DKIM/DMARC results before enabling buyers.
4. Set `ORDER_EMAILS_START_AT` to the actual UTC activation time and `ORDER_EMAILS_ENABLED=true` in production; redeploy. Leave unrelated legacy fulfillment, cancellation and deletion controls unchanged.
5. New checkouts now mark email ownership. Verify the first legitimate checkout queues `purchase_confirmation` and reaches `complete` with a corresponding `orderEmailDeliveries` state `sent`.

Until step 4, no customer email is sent and no old MailerLite delivery is bypassed. New purchases only is the default; backfill requires a separate explicit operation, never changing the date alone. Existing in-progress checkouts without the ownership marker retain old fulfillment.

## Reliability and support

The Stripe success URL `/shop/complete/?session_id=…` now stays on a localized order-confirmation page. It shares the email renderer, with website-specific support linking to orders@wonderlang.app in all 20 locales. The separate website-confirmation endpoint verifies the browser checkout secret, the registered live Stripe session, completed payment (including no-payment-required trials), and refund/dispute status before exposing the email or assigned key/link. Missing browser proof falls back to account sign-in. Unallocated keys show a localized pending message; the page never allocates another key. Existing conversion reporting runs independently without redirecting away. Dummy desktop/mobile previews: `node --import tsx scripts/preview-order-page.ts`.

Signed paid checkout webhooks enqueue stable `checkout:<session>` jobs. Invoice jobs use `invoice:<invoice>`. The existing outbox schedules delivery every minute and exponentially retries up to ten attempts. Desktop messages wait for the key allocator. Recipient must match the verified order; refunded or disputed payments are suppressed before send.

SMTP cannot guarantee exactly-once delivery after a lost acknowledgement. An independent send reservation prevents concurrent/replayed sends. Known SMTP rejections retry. Ambiguous send outcomes are held as `uncertain` (or `sending` after a process crash) and never blindly resent. Check Workspace Email Log Search using the recorded Message-ID. If Google accepted it, mark the delivery `sent`; only if confirmed not accepted may an administrator reset it to `retryable` and retry the failed outbox job. Record the reason in the admin audit. A sent email cannot be recalled by a later refund.

Admin → Operations already shows `purchase_confirmation` jobs and terminal failures. `orderEmailDeliveries` stores session/invoice references, language, stable Message-ID, state and timestamps; no email body, keys or SMTP password. Customer addresses and order data remain in the existing verified order. Firestore client access is denied.

Generate dummy previews: `node --import tsx scripts/preview-order-emails.ts`. Output is ignored under backups/order-email-previews. No real keys or recipients are used.

## Production activation

Backend commit 3f5f9e8 and key allocator commit 977b492 were published successfully on 2026-09-24. Commit 10d7b50 adds allowlisted SMTP error codes to the admin test response, without exposing provider responses or credentials; TypeScript validation passed.

The Workspace app password is stored as a production Netlify secret. Owner-only dummy preview emails reached the inbox. ORDER_EMAILS_START_AT is 2026-09-24T14:08:30.902Z and ORDER_EMAILS_ENABLED is true in production only. Deployment 6ab52f76f647130936cd4b78 published these settings; the live admin Operations card confirmed sending enabled, credential configured, and the expected start time. No historical order backfill was performed. The first legitimate new purchase still needs observation through queued purchase_confirmation to sent; no artificial paid order was created. 83 distinct focused tests previously passed, and English and Arabic previews were visually checked.
