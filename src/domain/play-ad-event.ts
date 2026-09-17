export interface PlaySubscriptionAdEvent {
  eventName: "StartTrial" | "Subscribe";
  eventId: string;
  value: number;
  currency: string;
}

// Never turn a displayed recurring price into revenue for a free trial.
export function playSubscriptionAdEvent(input: {
  testPurchase: boolean; active: boolean; trial: boolean;
  subscriptionId: string; startedAt: string; now: Date;
  currency?: string;
  order?: { id: string; createdAt: string; state: string; value: number; currency: string };
}): PlaySubscriptionAdEvent | undefined {
  if (input.testPurchase || !input.active) return undefined;
  const start = Date.parse(input.startedAt);
  const age = input.now.getTime() - start;
  // Existing restored subscriptions are not new acquisition conversions.
  // The configured trial is three days; allow seven days for delayed app resume.
  if (!Number.isFinite(age) || age < 0 || age > 7 * 86400_000) return undefined;
  if (input.trial) return input.currency && /^[A-Z]{3}$/.test(input.currency)
    ? {eventName:"StartTrial",eventId:`${input.subscriptionId}:trial`,value:0,currency:input.currency} : undefined;
  const order = input.order;
  if (!order || order.state !== "PROCESSED" || !Number.isFinite(order.value) || order.value <= 0 || !/^[A-Z]{3}$/.test(order.currency)) return undefined;
  const created = Date.parse(order.createdAt);
  if (!Number.isFinite(created) || created < start || created > input.now.getTime()) return undefined;
  return {eventName:"Subscribe",eventId:`${input.subscriptionId}:paid`,value:order.value,currency:order.currency};
}
