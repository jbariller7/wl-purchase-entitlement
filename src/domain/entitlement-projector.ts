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

export function projectEntitlements(
  uid: string,
  grants: readonly LedgerGrant[],
  now: Date,
  revision = 1
): EffectiveEntitlements {
  const effective = grants.filter((grant) => grant.uid === uid && isGrantEffective(grant, now.getTime()));
  const chapters = new Set<number>();
  const sourceGrantIds: string[] = [];
  let hasLifetime = false;
  let hasSubscription = false;
  let hasLegacy = false;
  let inGrace = false;
  let subscriptionEndsAt: string | undefined;
  let graceEndsAt: string | undefined;

  for (const grant of effective) {
    const capability = PRODUCT_CAPABILITIES[grant.product];
    if (!capability.fullGame && !capability.chapter) continue;
    sourceGrantIds.push(grant.id);
    if (capability.chapter) chapters.add(capability.chapter);
    if (
      grant.product === "mobile_full_lifetime" ||
      grant.product === "legacy_mobile_full" ||
      capability.chapter
    ) hasLifetime = true;
    else if (grant.product === "mobile_full_monthly") {
      hasSubscription = true;
      if (grant.state === "grace") inGrace = true;
      subscriptionEndsAt = laterIso(subscriptionEndsAt, grant.currentPeriodEndsAt ?? grant.endsAt);
      graceEndsAt = laterIso(graceEndsAt, grant.graceEndsAt);
    } else hasLegacy = true;
  }

  const fullGame = effective.some((grant) => PRODUCT_CAPABILITIES[grant.product].fullGame);
  const allLanguages = effective.some((grant) => PRODUCT_CAPABILITIES[grant.product].allLanguages);
  const cloudSave = effective.some((grant) => PRODUCT_CAPABILITIES[grant.product].cloudSave);
  const accessKind = hasLifetime ? "lifetime" : hasSubscription ? "subscription" : hasLegacy || chapters.size ? "legacy" : "none";

  return {
    uid,
    computedAt: now.toISOString(),
    revision,
    fullGame,
    allLanguages,
    cloudSave,
    chapters: [...chapters].sort((a, b) => a - b),
    accessKind,
    subscriptionState: hasSubscription ? (inGrace ? "grace" : "active") : "inactive",
    ...(subscriptionEndsAt ? { subscriptionEndsAt } : {}),
    ...(graceEndsAt ? { graceEndsAt } : {}),
    sourceGrantIds: sourceGrantIds.sort()
  };
}
