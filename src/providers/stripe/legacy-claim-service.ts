import type { DecodedIdToken } from "firebase-admin/auth";
import type Stripe from "stripe";
import type { LedgerGrant, LegacyOrder } from "../../domain/model.js";
import { HttpError, requireVerifiedEmail } from "../../http/auth.js";
import type { EntitlementStore } from "../../infrastructure/entitlement-store.js";
import { paymentLinkId, routeLegacyOrder } from "../../legacy/catalog.js";
import { stripeClient } from "./client.js";

function stringId(value: string | { id: string } | null): string | undefined {
  return typeof value === "string" ? value : value?.id;
}

function sessionEmail(session: Stripe.Checkout.Session): string | undefined {
  return session.customer_details?.email?.trim().toLowerCase() ?? session.customer_email?.trim().toLowerCase();
}

export async function claimHistoricalDesktopOrder(input: {
  store: EntitlementStore;
  user: DecodedIdToken;
  checkoutSessionId: string;
  now: Date;
}): Promise<{ discountEligible: true; orderId: string }> {
  const email = requireVerifiedEmail(input.user);
  if (!input.checkoutSessionId.startsWith("cs_")) throw new HttpError(400, "Enter the Stripe Checkout Session ID from the receipt.");
  const session = await stripeClient().checkout.sessions.retrieve(input.checkoutSessionId);
  if (session.payment_status !== "paid") throw new HttpError(403, "That historical checkout is not paid.");
  if (sessionEmail(session) !== email) throw new HttpError(403, "The receipt email does not match the verified account email.");
  const route = routeLegacyOrder({ paymentLink: session.payment_link, customFields: session.custom_fields });
  if (!route) throw new HttpError(403, "That checkout is not a verified WonderLang desktop Steam/Itch purchase.");
  const paymentIntentId = stringId(session.payment_intent as string | { id: string } | null);
  const legacyPaymentLinkId = paymentLinkId(session.payment_link);

  const order: LegacyOrder = {
    id: session.id,
    stripeCheckoutSessionId: session.id,
    ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
    buyerEmail: email,
    ...(legacyPaymentLinkId ? { paymentLinkId: legacyPaymentLinkId } : {}),
    productCode: route.productCode,
    playMode: route.playMode,
    quantity: route.quantity,
    amountTotal: session.amount_total ?? 0,
    currency: session.currency?.toUpperCase() ?? "USD",
    paidAt: new Date(session.created * 1000).toISOString(),
    firebaseUid: input.user.uid
  };
  await input.store.saveLegacyOrder(order);
  await input.store.claimLegacyOrder({
    uid: input.user.uid,
    email,
    checkoutSessionId: session.id,
    now: input.now
  });
  const product: LedgerGrant["product"] = route.productCode.startsWith("POLY_") ? "desktop_polyglot" : "desktop_language";
  await input.store.upsertGrant({
    id: "",
    uid: input.user.uid,
    provider: route.playMode === "STEAM" ? "steam" : "itch",
    providerTransactionId: session.id,
    product,
    state: "active",
    startsAt: new Date(session.created * 1000).toISOString(),
    metadata: { stripeCheckoutSessionId: session.id, productCode: route.productCode }
  }, { id: `legacy-claim:${session.id}`, created: session.created });
  return { discountEligible: true, orderId: session.id };
}
