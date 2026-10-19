# WonderLang.app launch preparation — 19 October 2026

The public homepage has NOT been switched. Ordinary builds still publish the marketing site at `/testsite/`; `/` continues to redirect to `/account/`. Existing account, admin, shop, webhook, API and installed-game URLs remain in place.

## Privacy update

The live source `https://lp.wonderlang.net/privacy-policy` was fetched directly on 19 October, because search returned an older cached policy. The complete English text is in `integrations/web/testsite/privacy-policy.json`; French and Spanish were manually translated in `privacy-translations.js`. The preview marks the text as a draft and preserves the source's six unfinished publication notes, without treating them as instructions or asserting the missing facts.

Before public launch, obtain the finalized policy and reconcile the opening paragraph (newsletter-only use/no third-party sharing) with the later account, payment, analytics and advertising disclosures. Outstanding source notes concern analytics/advertising bases and controls, objection/deletion procedures, retention, international processing, US-state rights, and children. This migration does not verify those app/backend claims. The updated text mainly describes apps and explicitly says it does not replace website cookie/newsletter notices; the public website needs an approved notice covering its own processing too.

Replace the English draft and manually update both translations. Remove the draft notices and update the displayed date, then set the policy JSON `status` to `approved`. The launch builder refuses activation while the status is a draft or the English publication notes remain. Do not simply delete notes and mark approval without resolving their content.

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

## Before activation

1. Resolve the privacy draft above and approve the finalized EN/FR/ES copy.
2. Review Preview A and Preview B in Admin → website experiments. Select/promote the desired default deliberately; do not accidentally reset an active experiment. The launch build preserves all registered designs and the server's current default. Use the newest prepared version for the immediate-render and explicit opt-out handoff fixes.
3. Confirm release facts. The live wonderlang.net homepage still says iOS, European Portuguese, Eastern Armenian and Swedish are coming soon; iOS beta access is described as available on request. No public iOS release was inferred. Funding totals on the new site are explicitly dated 24 September; refresh them from the actual donation register before launch if they changed.
4. Verify one authorized real purchase end-to-end, including a discounted offer: Stripe payment → entitlement/key/delivery → order email → browser confirmation → Meta receipt/deduplication → admin visibility. No test sale, email, subscription or customer grant was created during this preparation.
5. Verify a real contact-form message reaches Admin → Contacts and contact@wonderlang.net, and a consenting newsletter signup reaches the existing MailerLite form. Automated tests validate the flows but are not evidence of current SMTP or provider delivery.
6. Check desktop and phone layouts, all languages, the donation link, account sign-in, public sale prices/countdown, checkout return and A/B consent/withdrawal.

## Activation and rollback

After approval, set Netlify build environment `WEBSITE_LAUNCH=true` and deploy a fresh build. The builder emits the root marketing HTML and localized rewrite file into `public/`; its static root file shadows the existing unforced root-to-account redirect. It does not change `/account/`, authentication domains, Stripe endpoints, cloud-save CORS or mail DNS. Do not upload `dist/site-launch` as a production replacement: use the normal Netlify build so functions and existing headers are retained.

Check the live root, all seven pages, query-language HTML, sitemap, robots, security headers, shop, account, admin, health and webhook paths after deployment. Confirm the root no longer returns the account redirect and public pages have no noindex header. `/testsite/` remains a non-indexed preview.

Rollback: restore the previous Netlify published deploy, or unset `WEBSITE_LAUNCH` and build from a clean checkout. The generated root launch files are not committed, so an ordinary clean build restores the root account redirect. A local directory used for an activated build must be cleaned using a reviewed list of generated marketing files before reusing it for a disabled build; do not recursively delete `public/`, which contains live account/shop/admin assets.

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

Do not apply a blanket old-domain wildcard: legacy payment confirmation pages (including `/fgkl5656dh`), campaign links, newsletter landing pages and active ads need individual handling. Keep existing order/claim/recovery URLs and query parameters working. Update internal back-links such as the account widget's wonderlang.net link once the new root is active. Keep the old host and mail DNS; changing the website does not mean deleting email records.

Submit the new sitemap in Search Console after the public launch. Domain-move tools and permanent old-domain redirects should follow the verified cutover, not this preparation.
