import { PRODUCT_CAPABILITIES } from "./catalog.js";
import type { EffectiveEntitlements, LedgerGrant } from "./model.js";

function timestamp(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isGrantEffective(grant: LedgerGrant, nowMs: number): boolean {
  if (grant.state === "revoked" || grant.state === "refunded" || grant.state === "pending") return false;
  const start = timestamp(grant.startsAt);
  if (start === undefined || start > nowMs || grant.state === "expired") return false;
  if (grant.state === "grace") {
    const graceEnd = timestamp(grant.graceEndsAt);
    return graceEnd !== undefined && nowMs < graceEnd;
  }
  const end = timestamp(grant.endsAt);
  return end === undefined || nowMs < end;
}

function laterIso(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

type MobilePlatform = EffectiveEntitlements["mobilePlatforms"][number];

function platformFromGrant(grant: LedgerGrant): MobilePlatform | undefined {
  const configured = grant.metadata?.mobilePlatform ?? grant.metadata?.primaryMobilePlatform;
  if (configured === "android" || configured === "ios") return configured;
  if (grant.provider === "google_play") return "android";
  if (grant.provider === "apple") return "ios";
  return undefined;
}

export function projectEntitlements(
  uid: string,
  grants: readonly LedgerGrant[],
  now: Date,
  revision = 1
): EffectiveEntitlements {
  const effective = grants.filter((grant) => grant.uid === uid && isGrantEffective(grant, now.getTime()));
  const chapters = new Set<number>();
  const sourceGrantIds: string[] = [];
  const mobilePlatforms = new Set<MobilePlatform>();
  const permanentMobilePlatforms = new Set<MobilePlatform>();
  let hasPremiumLifetime = false;
  let hasPermanent = false;
  let hasSubscription = false;
  let hasLegacy = false;
  let inGrace = false;
  let subscriptionEndsAt: string | undefined;
  let graceEndsAt: string | undefined;

  for (const grant of effective) {
    const capability = PRODUCT_CAPABILITIES[grant.product];
    if (!capability.fullGame && !capability.chapter && !capability.pcMacAccess) continue;
    sourceGrantIds.push(grant.id);
    if (capability.chapter) chapters.add(capability.chapter);
    if (grant.product === "premium_lifetime_pass" || grant.product === "mobile_full_lifetime") {
      hasPremiumLifetime = true;
      const platform = platformFromGrant(grant);
      if (platform) {
        mobilePlatforms.add(platform);
        permanentMobilePlatforms.add(platform);
      }
      else {
        // Backward-compatible fallback for a pre-split lifetime grant whose
        // original checkout did not record a primary mobile platform.
        mobilePlatforms.add("android");
        mobilePlatforms.add("ios");
        permanentMobilePlatforms.add("android");
        permanentMobilePlatforms.add("ios");
      }
    } else if (grant.product === "mobile_polyglot_permanent" || grant.product === "legacy_mobile_full") {
      hasPermanent = true;
      const platform = platformFromGrant(grant);
      if (platform) {
        mobilePlatforms.add(platform);
        permanentMobilePlatforms.add(platform);
      }
      else if (grant.product === "legacy_mobile_full") {
        mobilePlatforms.add("android");
        mobilePlatforms.add("ios");
        permanentMobilePlatforms.add("android");
        permanentMobilePlatforms.add("ios");
      }
    } else if (grant.product === "mobile_full_monthly") {
      hasSubscription = true;
      // The account-linked subscription is cross-mobile while active. It does
      // not include PC/Mac or future-content ownership.
      mobilePlatforms.add("android");
      mobilePlatforms.add("ios");
      if (grant.state === "grace") inGrace = true;
      subscriptionEndsAt = laterIso(subscriptionEndsAt, grant.currentPeriodEndsAt ?? grant.endsAt);
      graceEndsAt = laterIso(graceEndsAt, grant.graceEndsAt);
    } else if (capability.fullGame || capability.chapter) hasLegacy = true;
  }

  const fullGame = effective.some((grant) => PRODUCT_CAPABILITIES[grant.product].fullGame);
  const allLanguages = effective.some((grant) => PRODUCT_CAPABILITIES[grant.product].allLanguages);
  const cloudSave = effective.some((grant) => PRODUCT_CAPABILITIES[grant.product].cloudSave);
  const pcMacAccess = effective.some((grant) => Boolean(PRODUCT_CAPABILITIES[grant.product].pcMacAccess));
  const futureContent = effective.some((grant) => Boolean(PRODUCT_CAPABILITIES[grant.product].futureContent));
  const secondMobilePlatformEligible = effective.some((grant) => Boolean(PRODUCT_CAPABILITIES[grant.product].secondMobilePlatformEligible));
  const accessKind = hasPremiumLifetime ? "premium_lifetime"
    : hasPermanent ? "permanent"
      : hasSubscription ? "subscription"
        : hasLegacy || chapters.size ? "legacy" : "none";

  return {
    uid,
    computedAt: now.toISOString(),
    revision,
    fullGame,
    allLanguages,
    cloudSave,
    mobilePlatforms: [...mobilePlatforms].sort(),
    permanentMobilePlatforms: [...permanentMobilePlatforms].sort(),
    pcMacAccess,
    futureContent,
    premiumLifetime: hasPremiumLifetime,
    secondMobilePlatformEligible,
    chapters: [...chapters].sort((a, b) => a - b),
    accessKind,
    subscriptionState: hasSubscription ? (inGrace ? "grace" : "active") : "inactive",
    ...(subscriptionEndsAt ? { subscriptionEndsAt } : {}),
    ...(graceEndsAt ? { graceEndsAt } : {}),
    sourceGrantIds: sourceGrantIds.sort()
  };
}
