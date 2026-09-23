# Newsletter discount links

Open wonderlang.app/admin/ and select **Discount links**. Enter the public campaign name, product, percentage, defaults and optional expiry, then select **Create discount link** and **Copy link**. The name appears on the offer page and Stripe checkout. Buyers can change currency and language; optional delivery, learning-language or mobile-platform constraints can be fixed by the administrator.

All five existing website offers are supported. Percentages apply to the original regional Stripe prices, without replacing the price table. Mobile Monthly supports the first payment, a number of months, or every payment, and retains its existing three-day trial. Stripe minimum-charge rules still apply to very large non-zero discounts.

Deactivate blocks new checkout requests immediately. Open unpaid Stripe sessions are queued for expiration; scheduled cleanup runs every minute and retries failures. Completed payments and subscription discounts already granted remain valid. Expired links cannot be reactivated; Duplicate creates a fresh campaign with new terms. Links are reusable by anyone who receives them; they are not recipient-specific.

## Implementation

The public WonderLang campaign URL selects the standard website checkout, which attaches a named, product-limited Stripe percentage coupon. Normal live price verification, guest recovery secret, request idempotency, delivery choice, order recording, entitlement claim, refund handling and browser/server advertising deduplication are preserved. Conversion values use the amount actually paid. Creating or previewing a campaign does not report a purchase.

Firestore collections: websiteDiscountLinks (admin-controlled campaign definitions) and websiteDiscountSessions (open-session cleanup queue). The discount-link-expiry Netlify function runs every minute and records health in operationalMetrics/discountLinkExpiry. Creation, activation and deactivation use the existing admin authentication, App Check, rate limits and audit history. No browser can supply a coupon or percentage directly.

Creation retries reserve a UUID and reuse a deterministic Stripe coupon ID and idempotency key. Incomplete setup can be retried from the admin list. Changes to terms require a new link, preventing a previously distributed campaign from silently changing price.

Validation: discount-links.test.ts covers currencies, server enforcement, coupon provisioning, expiry/deactivation, subscription preservation and translation coverage. website-commerce.test.ts exercises the discounted path through normal order fulfillment and stable Stripe retry parameters. Existing conversion, delivery, refund and event-processor tests also run.
