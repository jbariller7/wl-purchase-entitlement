# Security model and checklist

- Provider signatures, Google OIDC and Apple JWS are verified before event IDs or payloads are trusted.
- Firebase ID tokens are checked for revocation on authenticated account APIs.
- Provider customer, transaction and subscription IDs are immutable to one Firebase UID; conflicting links fail closed.
- Purchase tokens are hashed for identifiers and never returned to other clients. Clients cannot write grants or entitlement documents.
- Historical discount proof requires a paid, allowlisted WonderLang desktop Checkout Session and the same Firebase-verified email. The coupon is applied only by the server.
- Checkout Price/Coupon IDs are selected server-side. Client prices, products and entitlement claims are ignored.
- Webhooks return 5xx on processing failure, use a durable inbox and recover claims stuck in `processing` for more than five minutes.
- Outbox jobs have exclusive leases, stable dedupe keys, exponential retry and terminal failure after ten attempts.
- Ad payload email is SHA-256-normalized before the retrying outbox is written. Completed delivery payloads are immediately redacted. Full card data is never handled.
- Provider inboxes persist only event metadata plus a payload SHA-256 digest, never the raw Stripe, Play, or Apple notification. Operational errors are centrally stripped of emails, bearer tokens, API keys, webhook secrets, and private-key blocks before logs or retry records.
- Cloud paths are UID-scoped; signed URLs expire after ten minutes and target staging objects only; upload size and SHA-256 are checked before a create-only immutable revision is copied and committed to the manifest.
- Firestore and Storage client rules deny everything. Service-account and provider credentials belong only in Netlify secrets.

The audited account-deletion workflow is implemented with recent-login confirmation, immediate session revocation, a 30-day recovery window, and a separately disabled purge worker. Firestore deletion tests cover pseudonymizing linked ledger/order rows, removing internal buyer-email copies, canceling unfinished personal side effects, and deleting cloud paths. Provider-mocked tests cover clearing only Google Sheet email cells and issuing MailerLite GDPR forget requests without persisting provider response bodies. Before production: run one explicitly approved external deletion canary, approve minimized-ledger retention, enable Firebase App Check/rate limiting on public APIs, configure platform-level Netlify log redaction, restrict service-account IAM, rotate credentials after migration, and commission an external review of auth linking and store receipt replay cases.
