import { stripeEnv } from "../src/config/env.js";
import { MONTHLY_PRICE_USD_CENTS, POLYGLOT_PERMANENT_PRICE_USD_CENTS, PREMIUM_LIFETIME_PRICE_USD_CENTS } from "../src/domain/catalog.js";
import { stripeClient } from "../src/providers/stripe/client.js";

const [monthly, polyglot, premium, coupon] = await Promise.all([
  stripeClient().prices.retrieve(stripeEnv().STRIPE_PRICE_MOBILE_MONTHLY),
  stripeClient().prices.retrieve(stripeEnv().STRIPE_PRICE_POLYGLOT_PERMANENT),
  stripeClient().prices.retrieve(stripeEnv().STRIPE_PRICE_PREMIUM_LIFETIME),
  stripeClient().coupons.retrieve(stripeEnv().STRIPE_COUPON_LEGACY_DESKTOP_50)
]);

const errors: string[] = [];
if (!monthly.active) errors.push("Monthly Price is inactive.");
if (monthly.currency !== "usd") errors.push(`Monthly currency is ${monthly.currency}, expected usd.`);
if (monthly.unit_amount !== MONTHLY_PRICE_USD_CENTS) errors.push(`Monthly amount is ${monthly.unit_amount}, expected ${MONTHLY_PRICE_USD_CENTS}.`);
if (monthly.recurring?.interval !== "month" || monthly.recurring.interval_count !== 1) errors.push("Monthly Price is not a one-month recurring Price.");
if (!polyglot.active || polyglot.recurring || polyglot.unit_amount !== POLYGLOT_PERMANENT_PRICE_USD_CENTS) errors.push("Polyglot Price is not the expected active one-time USD amount.");
if (!premium.active || premium.recurring || premium.unit_amount !== PREMIUM_LIFETIME_PRICE_USD_CENTS) errors.push("Premium Price is not the expected active one-time USD amount.");
if (!coupon.valid) errors.push("Historical-customer Coupon is invalid.");
if (coupon.percent_off !== 50) errors.push(`Historical-customer Coupon is ${coupon.percent_off}%, expected 50%.`);
if (new Set([monthly.id, polyglot.id, premium.id]).size !== 3) errors.push("Monthly, Polyglot, and Premium Price IDs must be distinct.");

if (errors.length) {
  errors.forEach((message) => console.error(`ERROR: ${message}`));
  process.exitCode = 1;
} else {
  console.log(`Catalog valid: monthly USD ${(MONTHLY_PRICE_USD_CENTS / 100).toFixed(2)}, Polyglot USD ${(POLYGLOT_PERMANENT_PRICE_USD_CENTS / 100).toFixed(2)}, Premium USD ${(PREMIUM_LIFETIME_PRICE_USD_CENTS / 100).toFixed(2)}, private 50% coupon.`);
}
