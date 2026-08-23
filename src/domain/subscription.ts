import { STRIPE_FAILURE_GRACE_DAYS } from "./catalog.js";

export function stripeGraceEndsAt(failedAt: Date, days = STRIPE_FAILURE_GRACE_DAYS): string {
  const end = new Date(failedAt);
  end.setUTCDate(end.getUTCDate() + days);
  return end.toISOString();
}

export type NormalizedSubscriptionState = "active" | "grace" | "expired" | "pending";

export function normalizeStripeSubscriptionState(input: {
  stripeStatus: string;
  now: Date;
  graceEndsAt?: string;
}): NormalizedSubscriptionState {
  if (input.stripeStatus === "active" || input.stripeStatus === "trialing") return "active";
  if (input.stripeStatus === "incomplete") return "pending";
  if (input.stripeStatus === "past_due" || input.stripeStatus === "unpaid") {
    return input.graceEndsAt && input.now.getTime() < Date.parse(input.graceEndsAt) ? "grace" : "expired";
  }
  return "expired";
}
