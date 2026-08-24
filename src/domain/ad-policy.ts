export type AdConversionName = "Purchase" | "Subscribe" | "StartTrial";

export interface AdDecision {
  send: boolean;
  eventName?: AdConversionName;
  reason: string;
}

export function stripeInvoiceAdDecision(input: {
  billingReason: string | null;
  paid: boolean;
  amountPaid: number;
}): AdDecision {
  if (!input.paid || input.amountPaid <= 0) return { send: false, reason: "invoice_not_paid" };
  if (input.billingReason === "subscription_create") {
    return { send: true, eventName: "Subscribe", reason: "initial_subscription_payment" };
  }
  return { send: false, reason: "subscription_renewal_or_adjustment" };
}

export function checkoutAdDecision(input: { mode: string | null; paymentStatus: string | null }): AdDecision {
  if (input.paymentStatus !== "paid" && input.paymentStatus !== "no_payment_required") {
    return { send: false, reason: "checkout_not_paid" };
  }
  if (input.mode === "subscription") {
    if (input.paymentStatus === "no_payment_required") {
      return { send: true, eventName: "StartTrial", reason: "subscription_trial_started" };
    }
    return { send: false, reason: "subscription_conversion_comes_from_initial_invoice" };
  }
  return { send: true, eventName: "Purchase", reason: "one_time_purchase" };
}
