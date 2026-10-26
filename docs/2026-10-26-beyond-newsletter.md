# Beyond newsletter signup

Added three compact signup forms: below the opening campaign overview, after the combat section, and after the final FAQ. All three use the existing WonderLang MailerLite form 22154858 / 144956028970075999, with unique DOM IDs and the provider's unchanged subscribe endpoint.

The headline, copy, email label, submit/loading labels, consent/unsubscribe note, confirmation and errors are manually authored and proofread in all 18 supported page languages. Armenian and Traditional Chinese remain excluded. Screenshots and reward/payment behavior are unchanged.

The official MailerLite webforms script handles submission. The success callback updates all three placements only after MailerLite accepts the request. Invalid email messages and provider failures are localized. Native form submission remains available if the script cannot load. No email address is submitted on page load or attached to Meta events.

CSP permits only the MailerLite script/dependency/subscribe hosts needed by the existing embed, retaining the current restrictions elsewhere. No new serverless function or polling endpoint is introduced.

Source templates and manually authored strings: `work/beyondmockup/localization/newsletter.html` and `newsletter.json` in the Project1 workspace. They are added by `build.py`, without renumbering the existing source keys. Controller: `public/beyondmockup/newsletter.js`.

Validation: actual vendor runtime with intercepted responses; all 18 languages at 1440/390px; all three placements; unique IDs; invalid-email prevention; one confirmed signup updates all placements; network and field-error responses never show success. Twenty mocked submissions, zero real subscriptions or Meta events.

## Signup source and ad fields

The user confirmed existing MailerLite custom fields `utm_source`, `utm_medium`, `utm_campaign`, and `page_source`. The shared `public/newsletter-attribution.js` fills `fields[...]` using MailerLite's form serialization. Beyond uses `page_source=beyond`; the main site uses `page_source=site`. Template hidden inputs preserve page source without JavaScript. Public copies of older A/B designs also receive the shared script on production build.

UTMs come from the actual URL, with a 30-minute same-tab session cache for navigation. A new campaign replaces the previous tuple rather than mixing fields. Missing UTMs are omitted, preserving existing subscriber data. Explicit measurement refusal, Meta opt-out, global privacy control, or withdrawn marketing consent suppress and clear UTMs. Page source remains an operational signup label. No Facebook identifiers, email addresses, or new conversion events are stored by this helper.

Validated 13 intercepted submissions using the actual MailerLite runtime: both sites, all three Beyond forms, Unicode campaign names, navigation, campaign changes, missing fields, opt-outs, expiry, and blocked storage. Zero real subscriptions. This verifies outgoing provider payloads; no real subscriber profile was created/read to confirm storage in the MailerLite account.


## Corrected form routing
The original form was assigned to the unrelated PDF Content only group. The user supplied dedicated slugs: Beyond p7liQ5 and main site FbTGGC. Their public MailerLite definitions resolve to Beyond form 202396027072808304 / callback 47615766 and site form 202396171826627602 / callback 47615861. All three Beyond instances and public copies of older main-site A/B variants now use these destinations. UTM and page_source fields are preserved. Both provider definitions have double opt-in enabled. Existing subscriber group memberships were not modified. Submission QA intercepts real vendor requests and verifies destination IDs; it creates no live contacts.
