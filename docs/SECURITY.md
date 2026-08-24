# Security model and checklist

- Provider signatures, Google OIDC and Apple JWS are verified before event IDs or payloads are trusted.
- Firebase ID tokens are checked for revocation on authenticated account APIs.
- Provider customer, transaction and subscription IDs are immutable to one Firebase UID; conflicting links fail closed.
- Purchase tokens are hashed for identifiers and never returned to other clients. Clients cannot write grants or entitlement documents.
- Historical discount proof requires a paid, allowlisted WonderLang desktop Checkout Session and the same Firebase-verified email. The coupon is applied only by the server.
- Checkout Price/Coupon IDs are selected server-side. Client prices, products and entitlement claims are ignored.
- Webhooks return 5xx on processing failure, use a durable inbox and recover claims stuck in `processing` for more than five minutes.
- Outbox jobs have exclusive leases, stable dedupe keys, exponential retry and terminal failure after ten attempts.
- Ad payload email is SHA-256-normalized at send time. Full card data is never handled. Logs avoid raw tokens and buyer emails.
- Cloud paths are UID-scoped; signed URLs expire after ten minutes; upload size and SHA-256 are checked before manifest commit.
- Firestore and Storage client rules deny everything. Service-account and provider credentials belong only in Netlify secrets.

The audited account-deletion workflow is implemented with recent-login confirmation, immediate session revocation, a 30-day recovery window, and a separately disabled purge worker. Before production: approve and configure a time-based lifecycle for retained raw provider payloads, enable Firebase App Check/rate limiting on public APIs, configure Netlify log redaction, restrict service-account IAM, rotate credentials after migration, and commission an external review of auth linking and store receipt replay cases.
