# Beyond newsletter signup

Added three compact signup forms: below the opening campaign overview, after the combat section, and after the final FAQ. All three use the existing WonderLang MailerLite form 22154858 / 144956028970075999, with unique DOM IDs and the provider's unchanged subscribe endpoint.

The headline, copy, email label, submit/loading labels, consent/unsubscribe note, confirmation and errors are manually authored and proofread in all 18 supported page languages. Armenian and Traditional Chinese remain excluded. Screenshots and reward/payment behavior are unchanged.

The official MailerLite webforms script handles submission. The success callback updates all three placements only after MailerLite accepts the request. Invalid email messages and provider failures are localized. Native form submission remains available if the script cannot load. No email address is submitted on page load or attached to Meta events.

CSP permits only the MailerLite script/dependency/subscribe hosts needed by the existing embed, retaining the current restrictions elsewhere. No new serverless function or polling endpoint is introduced.

Source templates and manually authored strings: `work/beyondmockup/localization/newsletter.html` and `newsletter.json` in the Project1 workspace. They are added by `build.py`, without renumbering the existing source keys. Controller: `public/beyondmockup/newsletter.js`.

Validation: actual vendor runtime with intercepted responses; all 18 languages at 1440/390px; all three placements; unique IDs; invalid-email prevention; one confirmed signup updates all placements; network and field-error responses never show success. Twenty mocked submissions, zero real subscriptions or Meta events.
