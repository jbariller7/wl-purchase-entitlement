import type { LedgerGrant, Provider } from "./model.js";

export interface SubscriptionSummary {
  provider: Provider;
  phase: "trial" | "active" | "grace" | "pending" | "cancelled" | "paused" | "expired";
  providerStatus: string;
  startsAt: string;
  renewsAt: string | null;
  endsAt: string | null;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function providerStatus(grant: LedgerGrant): string {
  const metadata = grant.metadata ?? {};
  return text(metadata.stripeStatus)
    ?? text(metadata.playSubscriptionState)
    ?? (metadata.notificationStatus !== undefined ? String(metadata.notificationStatus) : grant.state);
}

function phase(grant: LedgerGrant): SubscriptionSummary["phase"] {
  const metadata = grant.metadata ?? {};
  const status = providerStatus(grant).toLowerCase();
  if (status === "trialing" || text(metadata.trialEndsAt)) return "trial";
  if (grant.state === "grace") return "grace";
  if (grant.state === "pending") return "pending";
  if (status.includes("pause")) return "paused";
  const cancelAtPeriodEnd = bool(metadata.cancelAtPeriodEnd) === true
    || bool(metadata.autoRenewEnabled) === false
    || Number(metadata.autoRenewStatus) === 0
    || status.includes("cancel");
  if (grant.state === "active" && cancelAtPeriodEnd) return "cancelled";
  if (grant.state === "active") return "active";
  return "expired";
}

export function summarizeSubscription(grants: readonly LedgerGrant[]): SubscriptionSummary | null {
  const subscriptions = grants
    .filter((grant) => grant.product === "mobile_full_monthly")
    .sort((a, b) => {
      const priority = (grant: LedgerGrant) => grant.state === "active" ? 4 : grant.state === "grace" ? 3 : grant.state === "pending" ? 2 : 1;
      return priority(b) - priority(a) || Date.parse(b.startsAt) - Date.parse(a.startsAt);
    });
  const grant = subscriptions[0];
  if (!grant) return null;
  const metadata = grant.metadata ?? {};
  const currentPhase = phase(grant);
  const cancelAtPeriodEnd = currentPhase === "cancelled";
  const periodEnd = grant.currentPeriodEndsAt ?? grant.endsAt ?? null;
  return {
    provider: grant.provider,
    phase: currentPhase,
    providerStatus: providerStatus(grant),
    startsAt: grant.startsAt,
    renewsAt: currentPhase === "active" || currentPhase === "trial" ? periodEnd : null,
    endsAt: cancelAtPeriodEnd || currentPhase === "expired" || currentPhase === "paused" ? periodEnd : null,
    trialEndsAt: text(metadata.trialEndsAt) ?? null,
    graceEndsAt: grant.graceEndsAt ?? null,
    cancelAtPeriodEnd
  };
}
