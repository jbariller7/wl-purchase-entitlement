import { google, type androidpublisher_v3 } from "googleapis";
import type { DeploymentControls, GooglePlayEnvironment } from "../../config/env.js";
import { normalizeGoogleServiceAccountPrivateKey } from "../../infrastructure/private-key.js";

export interface GooglePlayCatalogReader {
  subscription(packageName: string, productId: string): Promise<androidpublisher_v3.Schema$Subscription>;
  subscriptionOffers(packageName: string, productId: string, basePlanId: string): Promise<androidpublisher_v3.Schema$SubscriptionOffer[]>;
  oneTimeProduct(packageName: string, productId: string): Promise<androidpublisher_v3.Schema$OneTimeProduct>;
}

export interface GooglePlayDiagnosticCheck {
  id: string;
  label: string;
  state: "passed" | "failed";
  resourceId: string;
  issues: string[];
  details?: Record<string, string | number | boolean | string[] | null>;
}

export interface GooglePlayCatalogDiagnostic {
  checkedAt: string;
  passed: boolean;
  readOnly: true;
  packageName: string;
  rolloutPhase: GooglePlayEnvironment["GOOGLE_PLAY_POLYGLOT_ROLLOUT_PHASE"];
  webhookProcessingEnabled: boolean;
  checks: GooglePlayDiagnosticCheck[];
}

function decimalNanos(amount: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,9}))?$/.exec(amount);
  if (!match) throw new Error("Invalid expected Google Play amount.");
  return BigInt(match[1]!) * 1_000_000_000n + BigInt((match[2] ?? "").padEnd(9, "0") || "0");
}

function moneyMatches(money: androidpublisher_v3.Schema$Money | null | undefined, currency: string, amount: string): boolean {
  if (!money || money.currencyCode?.toUpperCase() !== currency) return false;
  const actual = BigInt(money.units ?? "0") * 1_000_000_000n + BigInt(money.nanos ?? 0);
  return actual === decimalNanos(amount);
}

function usBasePlan(basePlan: androidpublisher_v3.Schema$BasePlan): androidpublisher_v3.Schema$RegionalBasePlanConfig | undefined {
  return basePlan.regionalConfigs?.find((region) => region.regionCode === "US");
}

function usPurchaseOption(option: androidpublisher_v3.Schema$OneTimeProductPurchaseOption): androidpublisher_v3.Schema$OneTimeProductPurchaseOptionRegionalPricingAndAvailabilityConfig | undefined {
  return option.regionalPricingAndAvailabilityConfigs?.find((region) => region.regionCode === "US");
}

function result(input: Omit<GooglePlayDiagnosticCheck, "state">): GooglePlayDiagnosticCheck {
  return { ...input, state: input.issues.length ? "failed" : "passed" };
}

async function inspectMonthly(input: {
  reader: GooglePlayCatalogReader;
  environment: GooglePlayEnvironment;
}): Promise<GooglePlayDiagnosticCheck[]> {
  const { reader, environment } = input;
  const monthlyResource = `${environment.GOOGLE_PLAY_MONTHLY_PRODUCT_ID}/${environment.GOOGLE_PLAY_MONTHLY_BASE_PLAN_ID}`;
  try {
    const subscription = await reader.subscription(environment.GOOGLE_PLAY_PACKAGE_NAME, environment.GOOGLE_PLAY_MONTHLY_PRODUCT_ID);
    const basePlan = subscription.basePlans?.find((candidate) => candidate.basePlanId === environment.GOOGLE_PLAY_MONTHLY_BASE_PLAN_ID);
    const baseIssues: string[] = [];
    if (subscription.productId !== environment.GOOGLE_PLAY_MONTHLY_PRODUCT_ID) baseIssues.push("Google Play returned a different Monthly product ID.");
    if (!basePlan) baseIssues.push("The expected Monthly base plan is missing; the subscription cannot be sold yet.");
    if (basePlan) {
      const us = usBasePlan(basePlan);
      if (basePlan.state !== "ACTIVE") baseIssues.push("The Monthly base plan is not active.");
      if (basePlan.autoRenewingBasePlanType?.billingPeriodDuration !== "P1M") baseIssues.push("The Monthly base plan is not a one-month auto-renewing plan.");
      if (!us?.newSubscriberAvailability) baseIssues.push("The Monthly base plan is unavailable to new United States subscribers.");
      if (!moneyMatches(us?.price, "USD", "6.99")) baseIssues.push("The Monthly United States price is not USD 6.99.");
    }
    const baseCheck = result({
      id: "monthly-base-plan",
      label: "Mobile Monthly base plan",
      resourceId: monthlyResource,
      issues: baseIssues,
      details: basePlan ? {
        state: basePlan.state ?? "UNKNOWN",
        billingPeriod: basePlan.autoRenewingBasePlanType?.billingPeriodDuration ?? null,
        regionalConfigurations: basePlan.regionalConfigs?.length ?? 0,
        usPrice: moneyMatches(usBasePlan(basePlan)?.price, "USD", "6.99") ? "USD 6.99" : "Different or unavailable"
      } : { state: "MISSING", billingPeriod: null, regionalConfigurations: 0, usPrice: "Unavailable" }
    });

    if (!basePlan) {
      return [baseCheck, result({
        id: "monthly-three-day-trial",
        label: "Mobile Monthly three-day trial",
        resourceId: monthlyResource,
        issues: ["The trial cannot exist until the Monthly base plan is saved."],
        details: { state: "BLOCKED_BY_BASE_PLAN", duration: "P3D" }
      })];
    }

    try {
      const offers = await reader.subscriptionOffers(
        environment.GOOGLE_PLAY_PACKAGE_NAME,
        environment.GOOGLE_PLAY_MONTHLY_PRODUCT_ID,
        environment.GOOGLE_PLAY_MONTHLY_BASE_PLAN_ID
      );
      const trials = offers.filter((offer) => offer.phases?.some((phase) =>
        phase.duration === "P3D" && phase.recurrenceCount === 1 && (phase.regionalConfigs ?? []).length > 0
        && (phase.regionalConfigs ?? []).every((region) => region.free !== undefined && region.free !== null)
      ));
      const activeTrial = trials.find((offer) => offer.state === "ACTIVE");
      const trialIssues: string[] = [];
      if (!trials.length) trialIssues.push("No free three-day subscription offer exists for the Monthly base plan.");
      else if (!activeTrial) trialIssues.push("The three-day trial exists but is not active.");
      return [baseCheck, result({
        id: "monthly-three-day-trial",
        label: "Mobile Monthly three-day trial",
        resourceId: activeTrial?.offerId ?? trials[0]?.offerId ?? monthlyResource,
        issues: trialIssues,
        details: {
          state: activeTrial?.state ?? trials[0]?.state ?? "MISSING",
          duration: "P3D",
          matchingOffers: trials.length,
          regionalConfigurations: activeTrial?.regionalConfigs?.length ?? trials[0]?.regionalConfigs?.length ?? 0
        }
      })];
    } catch {
      return [baseCheck, result({
        id: "monthly-three-day-trial",
        label: "Mobile Monthly three-day trial",
        resourceId: monthlyResource,
        issues: ["Google Play could not read the Monthly offers with the configured credential."],
        details: { state: "UNKNOWN", duration: "P3D" }
      })];
    }
  } catch {
    return [
      result({
        id: "monthly-base-plan",
        label: "Mobile Monthly base plan",
        resourceId: monthlyResource,
        issues: ["Google Play could not read the Monthly subscription with the configured credential."]
      }),
      result({
        id: "monthly-three-day-trial",
        label: "Mobile Monthly three-day trial",
        resourceId: monthlyResource,
        issues: ["The Monthly subscription could not be inspected, so the trial is unverified."]
      })
    ];
  }
}

function inspectPurchaseOption(input: {
  option: androidpublisher_v3.Schema$OneTimeProductPurchaseOption | undefined;
  id: string;
  expectedResourceId: string;
  label: string;
  expectedState: "ACTIVE" | "DRAFT";
  expectedUsd: string;
  expectedLegacyCompatible: boolean;
}): GooglePlayDiagnosticCheck {
  const issues: string[] = [];
  const option = input.option;
  if (!option) issues.push("The expected purchase option is missing.");
  if (option) {
    const us = usPurchaseOption(option);
    if (option.state !== input.expectedState) issues.push(`Purchase option state is ${option.state ?? "UNKNOWN"}; expected ${input.expectedState}.`);
    if (option.buyOption?.legacyCompatible !== input.expectedLegacyCompatible) {
      issues.push(input.expectedLegacyCompatible ? "The legacy option is not marked Billing-library compatible." : "The new Polyglot option must not replace the legacy-compatible option.");
    }
    if (us?.availability !== "AVAILABLE") issues.push("The purchase option is unavailable in the United States.");
    if (!moneyMatches(us?.price, "USD", input.expectedUsd)) issues.push(`The United States price is not USD ${input.expectedUsd}.`);
  }
  return result({
    id: input.id,
    label: input.label,
    resourceId: option?.purchaseOptionId ?? input.expectedResourceId,
    issues,
    details: option ? {
      state: option.state ?? "UNKNOWN",
      legacyCompatible: option.buyOption?.legacyCompatible ?? false,
      usPrice: moneyMatches(usPurchaseOption(option)?.price, "USD", input.expectedUsd) ? `USD ${input.expectedUsd}` : "Different or unavailable",
      regionalConfigurations: option.regionalPricingAndAvailabilityConfigs?.length ?? 0
    } : { state: "MISSING", legacyCompatible: false, usPrice: "Unavailable", regionalConfigurations: 0 }
  });
}

async function inspectPolyglot(input: {
  reader: GooglePlayCatalogReader;
  environment: GooglePlayEnvironment;
}): Promise<GooglePlayDiagnosticCheck[]> {
  const { reader, environment } = input;
  try {
    const product = await reader.oneTimeProduct(environment.GOOGLE_PLAY_PACKAGE_NAME, environment.GOOGLE_PLAY_POLYGLOT_PRODUCT_ID);
    const options = product.purchaseOptions ?? [];
    const legacy = options.find((option) => option.purchaseOptionId === environment.GOOGLE_PLAY_LEGACY_PURCHASE_OPTION_ID);
    const polyglot = options.find((option) => option.purchaseOptionId === environment.GOOGLE_PLAY_POLYGLOT_PURCHASE_OPTION_ID);
    const newExpectedState = environment.GOOGLE_PLAY_POLYGLOT_ROLLOUT_PHASE === "compatible_update_live" ? "ACTIVE" : "DRAFT";
    const checks = [
      inspectPurchaseOption({
        option: legacy,
        id: "legacy-buy-option",
        expectedResourceId: environment.GOOGLE_PLAY_LEGACY_PURCHASE_OPTION_ID,
        label: "Legacy wonderlangfull purchase option",
        expectedState: "ACTIVE",
        expectedUsd: "25.99",
        expectedLegacyCompatible: true
      }),
      inspectPurchaseOption({
        option: polyglot,
        id: "polyglot-purchase-option",
        expectedResourceId: environment.GOOGLE_PLAY_POLYGLOT_PURCHASE_OPTION_ID,
        label: "Polyglot Permanent purchase option",
        expectedState: newExpectedState,
        expectedUsd: "31.99",
        expectedLegacyCompatible: false
      })
    ];
    if (product.productId !== environment.GOOGLE_PLAY_POLYGLOT_PRODUCT_ID) {
      return checks.map((check) => result({
        ...check,
        issues: ["Google Play returned a different Polyglot product ID.", ...check.issues]
      }));
    }
    return checks;
  } catch {
    return [
      result({
        id: "legacy-buy-option",
        label: "Legacy wonderlangfull purchase option",
        resourceId: environment.GOOGLE_PLAY_LEGACY_PURCHASE_OPTION_ID,
        issues: ["Google Play could not read the legacy purchase option with the configured credential."]
      }),
      result({
        id: "polyglot-purchase-option",
        label: "Polyglot Permanent purchase option",
        resourceId: environment.GOOGLE_PLAY_POLYGLOT_PURCHASE_OPTION_ID,
        issues: ["Google Play could not read the new Polyglot purchase option with the configured credential."]
      })
    ];
  }
}

export function createGooglePlayCatalogReader(environment: GooglePlayEnvironment): GooglePlayCatalogReader {
  let api: androidpublisher_v3.Androidpublisher | undefined;
  const client = (): androidpublisher_v3.Androidpublisher => {
    if (api) return api;
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: environment.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL,
        private_key: normalizeGoogleServiceAccountPrivateKey(environment.GOOGLE_PLAY_PRIVATE_KEY)
      },
      scopes: ["https://www.googleapis.com/auth/androidpublisher"]
    });
    api = google.androidpublisher({ version: "v3", auth });
    return api;
  };
  return {
    async subscription(packageName, productId) {
      return (await client().monetization.subscriptions.get({ packageName, productId })).data;
    },
    async subscriptionOffers(packageName, productId, basePlanId) {
      const response = await client().monetization.subscriptions.basePlans.offers.list({ packageName, productId, basePlanId, pageSize: 100 });
      return response.data.subscriptionOffers ?? [];
    },
    async oneTimeProduct(packageName, productId) {
      return (await client().monetization.onetimeproducts.get({ packageName, productId })).data;
    }
  };
}

export async function diagnoseGooglePlayCatalog(input: {
  reader: GooglePlayCatalogReader;
  environment: GooglePlayEnvironment;
  controls: Pick<DeploymentControls, "GOOGLE_PLAY_WEBHOOKS_ENABLED">;
  now: Date;
}): Promise<GooglePlayCatalogDiagnostic> {
  const checkGroups = await Promise.all([
    inspectMonthly({ reader: input.reader, environment: input.environment }),
    inspectPolyglot({ reader: input.reader, environment: input.environment })
  ]);
  const checks = checkGroups.flat();
  return {
    checkedAt: input.now.toISOString(),
    passed: checks.every((check) => check.state === "passed"),
    readOnly: true,
    packageName: input.environment.GOOGLE_PLAY_PACKAGE_NAME,
    rolloutPhase: input.environment.GOOGLE_PLAY_POLYGLOT_ROLLOUT_PHASE,
    webhookProcessingEnabled: input.controls.GOOGLE_PLAY_WEBHOOKS_ENABLED,
    checks
  };
}
