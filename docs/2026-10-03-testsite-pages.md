# Supporting-page migration

Source: public wonderlang.net navigation and lp.wonderlang.net pages, reviewed 3 October 2026.

## Routes

All routes are under `/testsite/`: `features/`, `study-tips/`, `crafting-the-game/`, `about-us/` (same About content), `contacts/`, `media/`, `terms-and-conditions/`, `privacy-policy/`.

English, French and Spanish page copy, navigation, form labels and form results are manually authored in `integrations/web/testsite/pages-content.js` and `page-render.js`. The language selector preserves a contact draft. The existing newsletter, donation pools and checkout remain on the homepage. Old checkout links and obsolete confirmation pages are not copied. Public release information keeps iOS, European Portuguese, Eastern Armenian and Swedish pending.

All 12 gallery images and seven feature images/animations are hosted locally. `page-assets.json` records source URLs. Four media videos retain their YouTube destinations; the original Kickstarter footage is labelled archival. Links open YouTube rather than loading tracking embeds before interaction.

The terms retain the published March 2025 provisions, with manually authored French/Spanish translations; this migration is not a legal review. The privacy description now covers the operational account, purchase, cloud-save, support and measurement services instead of claiming only newsletter email collection and no service-provider sharing.

## A/B behavior

`build-pages.mjs` adds a shared directory script and stylesheet to every retained homepage design. Experimental copy, design IDs, assignments, tokens and promotion controls remain intact. Supporting-page purchase buttons return to the homepage pricing section so its experiment enrollment feeds the existing checkout. Original campaign query parameters follow same-origin navigation; opted-out identifiers are excluded. Supporting pages do not fabricate conversion events.

## Contact workflow

POST `/.netlify/functions/contact` validates EN/FR/ES messages, exact allowed origins, body length, honeypot and IP/email/global limits. A browser UUID makes identical retries idempotent. A successful response means the message is persisted in the server-only Firestore `contactMessages` collection; it does not claim inbox delivery.

`contact-mail-worker` runs every minute, leases up to five pending messages and forwards each to the fixed recipient `contact@wonderlang.net`. The existing Workspace SMTP transport sends from `orders@wonderlang.app`, with the visitor as Reply-To. No automatic email is sent to an unverified visitor address. Failures retry with increasing delays, stop after six attempts, and remain visible in admin. Stable Message-ID and leases reduce duplicate notifications; an SMTP acknowledgement lost after acceptance can still cause a duplicate on retry.

Admin → Contacts lists saved messages and forwarding status, supports search within loaded results, status filtering, pagination, read/resolved states and retrying failed forwarding. All reads and writes use the existing admin authentication/App Check/rate-limit path. Status changes are audited. Public clients cannot read Firestore or the inbox.

No new secret is required: the worker reuses `ORDER_EMAIL_SMTP_PASSWORD`. The SMTP sender settings and purchase-confirmation transport behavior are unchanged.
