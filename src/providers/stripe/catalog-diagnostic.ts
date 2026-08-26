import type Stripe from "stripe";
import type { CatalogConfiguration, CatalogOfferKind } from "../../catalog/service.js";
import type { DeploymentControls, StripeEnvironment } from "../../config/env.js";
import { stripeMinorAmount } from "../../domain/regional-pricing.js";

type DiagnosticStripeClient = Pick<Stripe, "prices" | "products" | "coupons">;

export interface StripeDiagnosticCheck {
  id: string;
  label: string;
  state: "passed" | "failed";
  resourceId: string;
  issues: string[];
  details?: Record<string, string | number | boolean | string[] | null>;
}

export interface StripeCatalogDiagnostic {
  checkedAt: string;
  mode: "test" | "live" | "unknown";
  keyType: "restricted" | "standard" | "unknown";
  passed: boolean;
  readOnly: true;
  canarySwitches: {
    stripeMutations: boolean;
    stripeWebhooks: boolean;
    checkoutTestingEnabled: boolean;
  };
  checks: StripeDiagnosticCheck[];
}

const OPTIONAL_STRIPE_CURRENCIES = new Set(["KWD"]);

function safeProviderReadIssue(error: unknown, resourceLabel: string): string {
  const providerError = error as { type?: unknown; code?: unknown; statusCode?: unknown };
  const type = typeof providerError?.type === "string" ? providerError.type : "";
  const code = typeof providerError?.code === "string" ? providerError.code : "";
  const statusCode = typeof providerError?.statusCode === "number" ? providerError.statusCode : 0;
  if (type === "StripePermissionError" || statusCode === 403) {
    return `The restricted Stripe key lacks read permission for this ${resourceLabel}.`;
  }
  if (code === "resource_missing" || statusCode === 404) {
    return `This ${resourceLabel} does not exist in the configured Stripe test account or mode.`;
  }
  if (type === "StripeAuthenticationError" || statusCode === 401) {
    return "Stripe rejected the configured restricted test credential.";
  }
  return `Stripe could not read this ${resourceLabel} with the configured test credential.`;
}

function keyDescription(secret: string): Pick<StripeCatalogDiagnostic, "mode" | "keyType"> {
  const mode = /_(test)_/.test(secret) ? "test" : /_(live)_/.test(secret) ? "live" : "unknown";
  const keyType = secret.startsWith("rk_") ? "restricted" : secret.startsWith("sk_") ? "standard" : "unknown";
  return { mode, keyType };
}

function expectedOfferAmount(catalog: CatalogConfiguration, kind: CatalogOfferKind, currency: string): number {
  const amount = catalog.regionalPrices[kind][currency];
  if (!amount) throw new Error(`Missing ${kind} ${currency} catalog amount.`);
  return stripeMinorAmount(currency, amount);
}

async function inspectOffer(input: {
  client: DiagnosticStripeClient;
  catalog: CatalogConfiguration;
  kind: CatalogOfferKind;
}): Promise<StripeDiagnosticCheck> {
  const { client, catalog, kind } = input;
  const offer = catalog[kind];
  const label = kind === "monthly" ? "Mobile Monthly Stripe history Price"
    : kind === "polyglot" ? "Polyglot Stripe history Price" : "Premium Lifetime checkout Price";
  try {
    const price = await client.prices.retrieve(offer.stripePriceId, { expand: ["currency_options"] });
    const productId = typeof price.product === "string" ? price.product : price.product.id;
    const product = await client.products.retrieve(productId);
    const issues: string[] = [];
    if (price.livemode) issues.push("Price belongs to live mode instead of the Stripe test environment.");
    if (!price.active) issues.push("Price is inactive.");
    if (price.currency.toUpperCase() !== "USD") issues.push("Default currency is not USD.");
    if (price.unit_amount !== expectedOfferAmount(catalog, kind, "USD")) issues.push("Default USD amount does not match the WonderLang catalog.");
    if (kind === "monthly") {
      if (price.type !== "recurring" || price.recurring?.interval !== "month" || price.recurring.interval_count !== 1) {
        issues.push("Monthly Price is not a one-month recurring Price.");
      }
    } else if (price.type !== "one_time") {
      issues.push("Permanent Price is recurring instead of one-time.");
    }
    if (product.deleted) issues.push("Stripe Product is deleted.");
    else {
      if (product.livemode) issues.push("Stripe Product belongs to live mode.");
      if (!product.active) issues.push("Stripe Product is inactive.");
    }

    const options = price.currency_options ?? {};
    const mismatchedCurrencies: string[] = [];
    const missingCurrencies: string[] = [];
    for (const currency of Object.keys(catalog.regionalPrices[kind]).sort()) {
      if (currency === "USD") continue;
      const actual = options[currency.toLowerCase()]?.unit_amount;
      if (actual == null) {
        if (!OPTIONAL_STRIPE_CURRENCIES.has(currency)) missingCurrencies.push(currency);
      } else if (actual !== expectedOfferAmount(catalog, kind, currency)) {
        mismatchedCurrencies.push(currency);
      }
    }
    const expectedCurrencies = new Set(Object.keys(catalog.regionalPrices[kind]).map((value) => value.toLowerCase()));
    const unexpectedCurrencies = Object.keys(options).filter((currency) => !expectedCurrencies.has(currency)).map((value) => value.toUpperCase()).sort();
    if (missingCurrencies.length) issues.push(`Missing regional currencies: ${missingCurrencies.join(", ")}.`);
    if (mismatchedCurrencies.length) issues.push(`Regional amounts differ for: ${mismatchedCurrencies.join(", ")}.`);
    if (unexpectedCurrencies.length) issues.push(`Unexpected regional currencies: ${unexpectedCurrencies.join(", ")}.`);

    return {
      id: `${kind}-price`,
      label,
      state: issues.length ? "failed" : "passed",
      resourceId: price.id,
      issues,
      details: {
        productId,
        active: price.active,
        livemode: price.livemode,
        defaultCurrency: price.currency.toUpperCase(),
        defaultUnitAmount: price.unit_amount,
        configuredRegionalCurrencies: 1 + Object.keys(options).length,
        optionalCurrenciesUnavailable: [...OPTIONAL_STRIPE_CURRENCIES].filter((currency) => !options[currency.toLowerCase()])
      }
    };
  } catch (error) {
    return {
      id: `${kind}-price`,
      label,
      state: "failed",
      resourceId: offer.stripePriceId,
      issues: [safeProviderReadIssue(error, "Price and Product")]
    };
  }
}

async function inspectCoupon(client: DiagnosticStripeClient, couponId: string): Promise<StripeDiagnosticCheck> {
  try {
    const coupon = await client.coupons.retrieve(couponId);
    const issues: string[] = [];
    if (coupon.livemode) issues.push("Coupon belongs to live mode instead of the Stripe test environment.");
    if (!coupon.valid) issues.push("Coupon is not currently valid.");
    if (coupon.percent_off !== 50) issues.push("Coupon is not a 50% discount.");
    if (coupon.duration !== "once") issues.push("Coupon is not limited to one checkout.");
    return {
      id: "historical-owner-coupon",
      label: "Historical desktop-owner 50% Coupon",
      state: issues.length ? "failed" : "passed",
      resourceId: coupon.id,
      issues,
      details: {
        livemode: coupon.livemode,
        valid: coupon.valid,
        percentOff: coupon.percent_off,
        duration: coupon.duration
      }
    };
  } catch (error) {
    return {
      id: "historical-owner-coupon",
      label: "Historical desktop-owner 50% Coupon",
      state: "failed",
      resourceId: couponId,
      issues: [safeProviderReadIssue(error, "Coupon")]
    };
  }
}

export async function diagnoseStripeCatalog(input: {
  client: DiagnosticStripeClient;
  catalog: CatalogConfiguration;
  environment: Pick<StripeEnvironment, "STRIPE_SECRET_KEY" | "STRIPE_COUPON_LEGACY_DESKTOP_50">;
  controls: Pick<DeploymentControls, "STRIPE_MUTATIONS_ENABLED" | "STRIPE_WEBHOOKS_ENABLED">;
  now: Date;
}): Promise<StripeCatalogDiagnostic> {
  const checks = await Promise.all([
    inspectOffer({ client: input.client, catalog: input.catalog, kind: "monthly" }),
    inspectOffer({ client: input.client, catalog: input.catalog, kind: "polyglot" }),
    inspectOffer({ client: input.client, catalog: input.catalog, kind: "premium" }),
    inspectCoupon(input.client, input.environment.STRIPE_COUPON_LEGACY_DESKTOP_50)
  ]);
  const stripeMutations = input.controls.STRIPE_MUTATIONS_ENABLED;
  const stripeWebhooks = input.controls.STRIPE_WEBHOOKS_ENABLED;
  return {
    checkedAt: input.now.toISOString(),
    ...keyDescription(input.environment.STRIPE_SECRET_KEY),
    passed: checks.every((check) => check.state === "passed"),
    readOnly: true,
    canarySwitches: {
      stripeMutations,
      stripeWebhooks,
      checkoutTestingEnabled: stripeMutations && stripeWebhooks
    },
    checks
  };
}
