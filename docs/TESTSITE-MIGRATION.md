# WonderLang homepage preview and experiments

## Scope and editing

Preview homepage: https://wonderlang.app/testsite/ (noindex, nofollow).
Homepage languages: English, French, Spanish. Use `?lang=en`, `?lang=fr`, `?lang=es`.
The existing root/account/admin routes and wonderlang.net are not migrated by this release.
The original draft in `Documents/New WonderLang website` remains a reference; the deployed source lives in this repository.

- Layout: `public/testsite/index.html`, `public/testsite/site.css`.
- Manually authored translations: `integrations/web/testsite/content.json`.
- Homepage runtime: `integrations/web/testsite/site.js`; bundle via `node scripts/build-widget.mjs`.
- Original game/brand art was reused and compressed to WebP in `public/testsite/assets`.
- MailerLite signup uses supplied form 22154858, account 1292227, form 144956028970075999. Email is sent directly to MailerLite only on submission. The provider handles validation and confirmed success. Copy is localized in EN/FR/ES; signup is separate from optional experiment measurement. No real subscriber was added during verification.
- `/shop/` is the existing live widget. Prices, currency handling, website sales, expiry and countdown are shared with the normal site and demo. These are real purchases through the normal Stripe checkout, delivery, entitlement, email and advertising pipeline.

## Content audit

Reference: current wonderlang.net homepage, local draft, existing purchase catalog, and owner-confirmed release status (24 September 2026).

- Windows, macOS, Steam Deck and Android are available; iOS is pending.
- European Portuguese, Eastern Armenian and Swedish are pending. Arabic/Russian are available in Polyglot.
- Preserve eleven learning languages, fifteen explanation languages, 45+ hours, beginner/A1/A2, gameplay features, creator quote, demo, PDFs, classroom contact, community funding, Beyond and FAQ.
- Remove old hardcoded sale, Android-coming-soon copy, all-products-no-subscription claim, stale draft funding totals and specific unconfirmed launch promises.
- Desktop: one-time purchase. Android: monthly or permanent. Retired chapter purchases are not sold.
- Premium includes cloud saves and future iOS access once launched. Clarified this in the EN/FR/ES shared shop/Stripe descriptions too.
- Do not claim that exam-aligned practice is an exam certification or that the game alone guarantees fluency.
- Keep public homepage destination links. Subpages have not been migrated. Funding button opens the existing PayPal contribution page; no contribution was made during testing.

## Operating A/B tests

Admin → Website A/B tests. The default has **no active experiment**.

1. Review A and B with the admin preview links (`?variant=A` / `?variant=B`). These are excluded from experiment enrollment and results, but still accept real purchases.
2. Name and start an experiment. Allocation is 50/50 among consenting browsers.
3. Send all traffic to the **same normal `/testsite/` URL**. Do not run separate ad campaigns for A versus B; different traffic would confound the comparison.
4. A: adventure headline, demo CTA first. B: language-goal headline, editions CTA first, reversed desktop hero. All other content, products and prices match. This tests the whole hero package, not which individual change caused an effect.
5. Keep the design fixed during a run. Pausing stops new enrollments; enrolled browsers retain their variant and can convert within their existing window. Starting a new named experiment creates a separate dataset. Previous results remain selectable.
6. Compare verified paying browsers / exposed browsers as the primary metric. Check shop clicks, checkouts, monthly starts and outbound store clicks as supporting measures. Export aggregate CSV if needed.

With about two direct website purchases/day before consent/bot exclusions, small sales lifts may require months of traffic. Do not stop on the first good day or declare a winner from a handful of sales. The dashboard gives Wilson 95% intervals per variant, not a significance test of their difference, and never automatically declares a winner. Check allocation imbalance and allow 14 days for the final enrolled visitors to convert after pausing. Language/device/source/country segments are exploratory; their samples will be smaller still.

## Measurement contract

- Optional first-party measurement only after consent. Stores consent choice plus a random browser UUID locally; server stores a hashed enrollment token, not the UUID or customer email. No replay or newsletter-email collection in experiment analytics. Newsletter signup separately sends email to MailerLite.
- Withdrawal removes the local visitor ID, clears token-bearing shop links, and marks the enrollment withdrawn server-side to stop future optional events/purchase attribution. Previously collected aggregates remain. If the withdrawal request cannot reach the server, future page collection still stops locally; an already-open checkout may retain its token.
- Enrollment window: 14 days. Same browser stays assigned within an experiment. Clearing storage or using another browser/device can create another enrollment; this is not a cross-device person count.
- Exposure only when document is visible. Funnel actions count once per enrolled browser; checkouts and monthly starts come from the server.
- Purchase counts require an existing exposed enrollment and a verified positive **live Stripe payment**. Browser requests cannot submit purchase, checkout or trial metrics.
- One-time purchases deduplicate by Stripe session ID. Subscription charges deduplicate by invoice ID. A paying browser counts once; additional real transactions still add gross revenue. Zero-value trial invoices/free orders do not count as purchases.
- Amounts are gross paid, tax-inclusive, before refunds and fees. Currencies are separate. This is conversion reporting, not accounting or net LTV.
- Order fulfillment and existing Meta/TikTok/Google reporting are retained. This experiment layer does not create extra ad conversion events.
- Native app-store purchases and Steam purchases are not attributed as verified website sales. Store clicks are shown separately; Steam URLs carry experiment/variant UTM tags for aggregate Steamworks comparison. The existing Steam PDF-request Purchase proxy remains untouched.
- Segments: initial page language, desktop/mobile viewport category, country when provided by hosting, and broad UTM/click-derived source category. `direct` includes unattributed/organic visits; raw UTM labels, referrer URLs and ad IDs are not stored in the experiment dataset.
- Known crawler/headless/preview user agents are excluded; IP-based rate limiting reduces abuse. This does not identify every bot. Consent refusal, blockers, failed requests and storage clearing create gaps. Do not divide recorded purchases by unrelated all-visitor counts.
- No new third-party analytics subscription. Data is server-owned Firestore behind existing deny-all client rules; results/configuration require the existing administrator API.

## Technical paths

`website-experiment` is the public, same-origin POST collector. Admin `/admin-api/v1/experiments` manages configuration and aggregate reports. Firestore collections: `websiteExperiments`, `websiteExperimentEnrollments`, `websiteExperimentResults`, `websiteExperimentReceipts`. Do not place secrets or email addresses in experiment names.

The opaque token passes from homepage to shop to checkout. Checkout validates it and freezes accepted attribution in the persisted checkout attempt to preserve Stripe idempotency on retries. Stripe session/subscription metadata carries the token for verified payment processing. Normal purchases without a token follow the existing path.

Automated regression coverage includes assignment persistence/pause, exposure/click/transaction deduplication, free-trial handling, expiry, withdrawal, unknown tokens, browser-forged event rejection, bot filtering, checkout metadata and interrupted Stripe retries. Preview review covers desktop/mobile layouts, all three languages, variant CTAs, navigation, FAQ, MailerLite form and the shared shop.

## Restored homepage content (24 September 2026)

- All four original GIFs are copied unchanged from the draft: two gameplay demonstrations and two decorative characters. Keep these animated; do not flatten them during image optimization.
- All 28 language pools use the current wonderlang.net totals, not the stale draft. `integrations/web/testsite/funding.json` stores the snapshot, goal, source and date. The page labels totals as a dated snapshot, not live accounting. Update this file and the localized date when reconciling new contributions.
- Contributions retain the existing PayPal destination and US$19/30/60 reward tiers. The page distinguishes funded/released Arabic and Russian from funded/in-development Eastern Armenian and Swedish, and preserves the donation terms and new-pool option.
- The supplied MailerLite provider script loads its jQuery/inputmask dependencies. CSP permits only its required hosts for scripts, connect and form submission; no inline scripts or general third-party wildcard were added.
