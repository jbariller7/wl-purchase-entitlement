# WonderLang.app launch preparation — 19 October 2026

The owner authorized the public root launch on 19 October 2026. Production builds now enable `WEBSITE_LAUNCH=true` in `netlify.toml`, publishing the marketing homepage at `/` and all supporting pages at their root paths. `/account/` remains the account/sign-in page; `/login` and `/login/` redirect there. The main site's existing “My account” navigation opens it. Account and checkout back-links now point to wonderlang.app. Existing admin, shop, webhook, API and installed-game URLs remain in place.

## Privacy update

The owner supplied the finalized WonderLang Privacy Policy, effective 19 October 2026, in this conversation. It supersedes the unfinished draft fetched from `https://lp.wonderlang.net/privacy-policy`. The complete English wording is in `integrations/web/testsite/privacy-policy.json`; its scope paragraph is displayed as the page introduction. French and Spanish were manually translated in `privacy-translations.js`. All twelve numbered sections and the provider links are retained. Draft banners and publication notes have been removed; the displayed date is the effective date.

The policy records the owner's stated retention periods, manual deletion within 72 hours of a verified request, SDK disclosures and age policy. Publishing this text does not change or independently audit backend retention, deletion jobs, native SDK settings or consent controls. The owner explicitly requested that the homepage's existing “9 and up” audience wording remain unchanged; the supplied 16+ wording appears in the privacy policy only.

The policy source is marked `approved`. The builder still rejects a future draft or unresolved English publication notes. Homepage activation is controlled separately by the production build flag above.

## Prepared launch build

Run `npm run prepare:site-launch` to build `dist/site-launch/` and `dist/site-launch-report.json`. This local artifact remains noindex and is not deployed automatically. It contains:

- Root homepage and all seven supporting pages; About and Contact aliases.
- English, French and Spanish HTML, canonical/alternate-language links, social previews and a sitemap.
- French/Spanish query-language rewrites to pre-rendered HTML (`?lang=fr`, `?lang=es`), preserving the existing language selector.
- Root copies of existing A/B designs with root-relative URLs. Original `/testsite/versions/` snapshots remain intact. Shared navigation/privacy wording applies across versions.
- The same `/shop/` purchase engine, account links, live sales and currency prices.
- Targeted marketing-page security headers; no wildcard rewrite that swallows API/admin/shop paths.

The homepage pre-renders its main authored text; rich cards, live prices and experiments still need JavaScript. A/B visits can move to `/versions/<design>/`; these version URLs declare the canonical homepage URL to consolidate search indexing. Preview A/B links remain noindex and do not enroll.

## Measurement

The prepared homepage passes explicit opt-out to the shop until measurement is accepted. The shop also respects a saved homepage refusal, including visits from older retained designs. Real attribution identifiers are preserved on the accepted path. A shared EN/FR/ES notice now explains site experiments and checkout advertising measurement, including hashed email matching. This does not change native SDK consent settings or independently certify them.

## Launch checks and follow-up

1. Review the finalized privacy page in English, French and Spanish. Confirm that operational processes continue to meet the owner-supplied commitments.
2. The launch preserves all registered designs and the server's current default. The public configuration read before cutover returned `page-67ecf711e23b3d3b17ca`, variant A. Existing previews and promotion controls remain available in Admin → website experiments. Promoting another design ends the active experiment; no promotion or experiment reset was performed as part of this domain-path cutover.
3. Confirm release facts. The live wonderlang.net homepage still says iOS, European Portuguese, Eastern Armenian and Swedish are coming soon; iOS beta access is described as available on request. No public iOS release was inferred. Funding totals on the new site are explicitly dated 24 September; refresh them from the actual donation register before launch if they changed.
4. Verify one authorized real purchase end-to-end, including a discounted offer: Stripe payment → entitlement/key/delivery → order email → browser confirmation → Meta receipt/deduplication → admin visibility. No test sale, email, subscription or customer grant was created during this preparation.
5. Verify a real contact-form message reaches Admin → Contacts and contact@wonderlang.net, and a consenting newsletter signup reaches the existing MailerLite form. Automated tests validate the flows but are not evidence of current SMTP or provider delivery.
6. Check desktop and phone layouts, all languages, the donation link, account sign-in, public sale prices/countdown, checkout return and A/B consent/withdrawal.

## Activation and rollback

The approved production build sets `WEBSITE_LAUNCH=true` through the version-controlled production context in `netlify.toml`. The builder emits the root marketing HTML and localized rewrite file into `public/`; its static root file shadows the existing unforced root-to-account redirect. It does not change `/account/`, authentication domains, Stripe endpoints, cloud-save CORS or mail DNS. Do not upload `dist/site-launch` as a production replacement: use the normal Netlify build so functions and existing headers are retained.

Check the live root, all seven pages, query-language HTML, sitemap, robots, security headers, shop, account, admin, health and webhook paths after deployment. Confirm the root no longer returns the account redirect and public pages have no noindex header. `/testsite/` remains a non-indexed preview.

Rollback: restore Netlify deploy `6ad64d5d6ec64c50d74932ad` (final policy before root launch), or set `WEBSITE_LAUNCH=false` in the production context and build from a clean checkout. The generated root launch files are not committed, so a disabled clean build restores the root account redirect. A local directory used for an activated build must be cleaned using a reviewed list of generated marketing files before reusing it for a disabled build; do not recursively delete `public/`, which contains live account/shop/admin assets.

## Old-domain migration is a separate cutover

Keep wonderlang.net and lp.wonderlang.net available until the root launch is verified. Then configure path-specific permanent redirects on their hosting/Cloudflare side, preserving campaign query strings:

| Old path | New target |
| --- | --- |
| `/` | `https://wonderlang.app/` |
| `/features` | `https://wonderlang.app/features/` |
| `/study-tips` | `https://wonderlang.app/study-tips/` |
| `/crafting-the-game`, `/about-us` | `https://wonderlang.app/crafting-the-game/` |
| `/contacts`, `/contact` | `https://wonderlang.app/contacts/` |
| `/media` | `https://wonderlang.app/media/` |
| `/terms-and-conditions` | `https://wonderlang.app/terms-and-conditions/` |
| `/privacy-policy` | `https://wonderlang.app/privacy-policy/` |

Do not apply a blanket old-domain wildcard: legacy payment confirmation pages (including `/fgkl5656dh`), campaign links, newsletter landing pages and active ads need individual handling. Keep existing order/claim/recovery URLs and query parameters working. Account and shop internal back-links have been updated to wonderlang.app. Keep the old host and mail DNS; changing the website does not mean deleting email records.

Submit the new sitemap in Search Console after the public launch. Domain-move tools and permanent old-domain redirects should follow the verified cutover, not this preparation.
