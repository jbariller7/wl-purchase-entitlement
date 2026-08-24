import type { DecodedIdToken } from "firebase-admin/auth";
import { z } from "zod";
import { CatalogService } from "../../catalog/service.js";
import { env } from "../../config/env.js";
import { canUseLegacyLifetimeDiscount } from "../../domain/legacy-discount.js";
import { planLifetimeTransition } from "../../domain/lifetime-transition.js";
import { STRIPE_SUBSCRIPTION_TRIAL_DAYS } from "../../domain/catalog.js";
import { HttpError } from "../../http/auth.js";
import type { EntitlementStore } from "../../infrastructure/entitlement-store.js";
import { stripeClient } from "./client.js";

export const checkoutRequestSchema = z.object({
  product: z.enum(["mobile_full_monthly", "mobile_full_lifetime"]),
  useLegacyDesktopDiscount: z.boolean().optional().default(false),
  confirmCancelExistingSubscription: z.boolean().optional().default(false),
  attribution: z.object({
    fbp: z.string().max(255).optional(),
    fbc: z.string().max(255).optional(),
    ttclid: z.string().max(255).optional(),
    ttp: z.string().max(255).optional()
  }).optional()
});

export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

function withSessionId(url: string): string {
  const target = new URL(url);
  target.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
  return target.toString().replace("%7BCHECKOUT_SESSION_ID%7D", "{CHECKOUT_SESSION_ID}");
}

async function stripeCustomerForUser(store: EntitlementStore, user: DecodedIdToken, now: Date): Promise<string> {
  const existing = await store.stripeCustomerId(user.uid);
  if (existing) return existing;
  const customer = await stripeClient().customers.create({
    ...(user.email ? { email: user.email } : {}),
    metadata: { firebase_uid: user.uid }
  }, { idempotencyKey: `firebase-customer-${user.uid}` });
  await store.linkStripeCustomer(user.uid, customer.id, user.email, now);
  return customer.id;
}

export async function createCheckout(input: {
  store: EntitlementStore;
  user: DecodedIdToken;
  request: CheckoutRequest;
  ipAddress?: string;
  userAgent?: string;
  now: Date;
}): Promise<{ url: string; sessionId: string; warning?: string }> {
  if (!env().STRIPE_MUTATIONS_ENABLED) throw new HttpError(503, "Checkout is disabled for this deployment.");
  const { store, user, request, now } = input;
  const effective = await store.effectiveEntitlements(user.uid, now);
  if (effective.accessKind === "lifetime") throw new HttpError(409, "This account already has lifetime access.");

  const activeSubscription = await store.activeSubscription(user.uid);
  if (request.product === "mobile_full_monthly" && activeSubscription) {
    throw new HttpError(409, "This account already has an active subscription.");
  }
  if (request.useLegacyDesktopDiscount && request.product !== "mobile_full_lifetime") {
    throw new HttpError(400, "The historical-customer discount applies only to lifetime access.");
  }

  const transition = planLifetimeTransition({
    uid: user.uid,
    confirmedCancelExistingSubscription: request.confirmCancelExistingSubscription,
    ...(activeSubscription?.provider === "stripe"
      ? { activeStripeSubscriptionId: activeSubscription.providerSubscriptionId }
      : {}),
    ...(activeSubscription?.provider === "google_play" || activeSubscription?.provider === "apple"
      ? { activeStoreSubscription: activeSubscription.provider }
      : {})
  });
  if (request.product === "mobile_full_lifetime" && !transition.allowCheckout) {
    throw new HttpError(409, transition.warning ?? "Subscription cancellation confirmation is required.");
  }

  if (request.useLegacyDesktopDiscount) {
    const claim = await store.legacyDiscountClaim(user.uid);
    if (!claim || !canUseLegacyLifetimeDiscount(claim, now)) {
      throw new HttpError(403, "No unused verified desktop-customer discount is available.");
    }
  }

  const customerId = await stripeCustomerForUser(store, user, now);
  const isMonthly = request.product === "mobile_full_monthly";
  const catalog = await new CatalogService(store.firestore()).get();
  const metadata: Record<string, string> = {
    wl_uid: user.uid,
    wl_product: request.product,
    wl_legacy_discount: request.useLegacyDesktopDiscount ? "1" : "0",
    ...(transition.cancelStripeSubscriptionAfterPayment
      ? { wl_cancel_stripe_subscription: transition.cancelStripeSubscriptionAfterPayment }
      : {}),
    ...(transition.externalCancellationRequired
      ? { wl_external_cancellation_required: transition.externalCancellationRequired }
      : {})
  };
  const expiresAt = Math.floor(now.getTime() / 1000) + 60 * 60;
  const session = await stripeClient().checkout.sessions.create({
    mode: isMonthly ? "subscription" : "payment",
    customer: customerId,
    client_reference_id: user.uid,
    line_items: [{
      price: isMonthly ? catalog.monthly.stripePriceId : catalog.lifetime.stripePriceId,
      quantity: 1
    }],
    success_url: withSessionId(env().STRIPE_SUCCESS_URL),
    cancel_url: env().STRIPE_CANCEL_URL,
    expires_at: expiresAt,
    allow_promotion_codes: false,
    metadata,
    ...(isMonthly ? {
      subscription_data: {
        metadata,
        trial_period_days: STRIPE_SUBSCRIPTION_TRIAL_DAYS
      }
    } : {}),
    ...(request.useLegacyDesktopDiscount
      ? { discounts: [{ coupon: env().STRIPE_COUPON_LEGACY_DESKTOP_50 }] }
      : {})
  }, { idempotencyKey: `checkout-${user.uid}-${request.product}-${request.useLegacyDesktopDiscount ? "discount" : "standard"}-${Math.floor(now.getTime() / 300000)}` });

  if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
  try {
    if (request.useLegacyDesktopDiscount) {
      await store.reserveLegacyDiscount(user.uid, session.id, new Date(expiresAt * 1000), now);
    }
    const attribution = request.attribution;
    await store.saveCheckoutContext(session.id, {
      uid: user.uid,
      ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
      ...(input.userAgent ? { userAgent: input.userAgent.slice(0, 500) } : {}),
      ...(attribution?.fbp ? { fbp: attribution.fbp } : {}),
      ...(attribution?.fbc ? { fbc: attribution.fbc } : {}),
      ...(attribution?.ttclid ? { ttclid: attribution.ttclid } : {}),
      ...(attribution?.ttp ? { ttp: attribution.ttp } : {})
    }, now);
  } catch (error) {
    await stripeClient().checkout.sessions.expire(session.id).catch(() => undefined);
    throw error;
  }
  return {
    url: session.url,
    sessionId: session.id,
    ...(transition.warning ? { warning: transition.warning } : {})
  };
}

export async function createBillingPortal(store: EntitlementStore, user: DecodedIdToken): Promise<string> {
  if (!env().STRIPE_MUTATIONS_ENABLED) throw new HttpError(503, "Billing portal access is disabled for this deployment.");
  const customerId = await store.stripeCustomerId(user.uid);
  if (!customerId) throw new HttpError(404, "No Stripe billing account is linked to this user.");
  const session = await stripeClient().billingPortal.sessions.create({
    customer: customerId,
    return_url: env().STRIPE_PORTAL_RETURN_URL
  });
  return session.url;
}
