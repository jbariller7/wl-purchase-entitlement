# Existing Netlify environment migration

Rename/copy the old `wonderlang-keys` variables:

| Old | New |
|---|---|
| `STRIPE_API_KEY` | `STRIPE_SECRET_KEY` |
| `GOOGLE_SHEETS_ID` | `GOOGLE_SHEET_ID` |
| `GOOGLE_SA_EMAIL` | `GOOGLE_SERVICE_ACCOUNT_EMAIL` |
| `GOOGLE_SA_PRIVATE_KEY` | `GOOGLE_PRIVATE_KEY` |
| `MAILERLITE_API_KEY` | `MAILERLITE_API_TOKEN` |
| `META_PIXEL` | `META_PIXEL_ID` |
| `TIKTOK_PIXEL` | `TIKTOK_PIXEL_ID` |
| `TIKTOK_API_KEY` (when used as the event token) | `TIKTOK_ACCESS_TOKEN` |

Google Sheets fulfillment continues to use `GOOGLE_SERVICE_ACCOUNT_EMAIL` and
`GOOGLE_PRIVATE_KEY`. Android Publisher must instead use the dedicated
`GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PLAY_PRIVATE_KEY` variables;
there is deliberately no runtime fallback between these credential families.

MailerLite group/key-field variables keep their old names. The old language-specific `ML_GROUPS_FR`, `ML_GROUPS_ES`, and similar variables were declared but never used by the live function, so the replacement intentionally preserves the actual `ALL + POLY_STEAM/POLY_ITCH` routing. Add all Firebase, Stripe Price/Coupon and provider-notification variables from `.env.example`.

Create a new Stripe webhook signing secret for the new endpoint. Never reuse or expose the old secret in source control.
