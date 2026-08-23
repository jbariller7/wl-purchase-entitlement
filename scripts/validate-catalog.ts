import { env } from "../src/config/env.js";
import { MONTHLY_PRICE_USD_CENTS } from "../src/domain/catalog.js";
import { stripeClient } from "../src/providers/stripe/client.js";

const [monthly, lifetime, coupon] = await Promise.all([
  stripeClient().prices.retrieve(env().STRIPE_PRICE_MOBILE_MONTHLY),
  stripeClient().prices.retrieve(env().STRIPE_PRICE_MOBILE_LIFETIME),
  stripeClient().coupons.retrieve(env().STRIPE_COUPON_LEGACY_DESKTOP_50)
]);

const errors: string[] = [];
if (!monthly.active) errors.push("Monthly Price is inactive.");
if (monthly.currency !== "usd") errors.push(`Monthly currency is ${monthly.currency}, expected usd.`);
if (monthly.unit_amount !== MONTHLY_PRICE_USD_CENTS) errors.push(`Monthly amount is ${monthly.unit_amount}, expected ${MONTHLY_PRICE_USD_CENTS}.`);
if (monthly.recurring?.interval !== "month" || monthly.recurring.interval_count !== 1) errors.push("Monthly Price is not a one-month recurring Price.");
if (!lifetime.active) errors.push("Lifetime Price is inactive.");
if (lifetime.recurring) errors.push("Lifetime Price must be one-time, not recurring.");
if (!lifetime.unit_amount || lifetime.unit_amount <= 0) errors.push("Lifetime Price has no positive fixed amount.");
if (!coupon.valid) errors.push("Historical-customer Coupon is invalid.");
if (coupon.percent_off !== 50) errors.push(`Historical-customer Coupon is ${coupon.percent_off}%, expected 50%.`);
if (monthly.id === lifetime.id) errors.push("Monthly and lifetime Price IDs are identical.");

if (errors.length) {
  errors.forEach((message) => console.error(`ERROR: ${message}`));
  process.exitCode = 1;
} else {
  console.log(`Catalog valid: monthly USD ${(MONTHLY_PRICE_USD_CENTS / 100).toFixed(2)}, lifetime ${lifetime.currency.toUpperCase()} ${((lifetime.unit_amount ?? 0) / 100).toFixed(2)}, private 50% coupon.`);
}
