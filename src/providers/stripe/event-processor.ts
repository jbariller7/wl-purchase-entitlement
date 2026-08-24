import type Stripe from "stripe";
import { CatalogService } from "../../catalog/service.js";
import { deploymentControls, env } from "../../config/env.js";
import { checkoutAdDecision, stripeInvoiceAdDecision, type AdConversionName } from "../../domain/ad-policy.js";
import type { LedgerGrant, LegacyOrder } from "../../domain/model.js";
import { normalizeStripeSubscriptionState, stripeGraceEndsAt } from "../../domain/subscription.js";
import { stripeMajorValue } from "../../domain/regional-pricing.js";
import type { EntitlementStore } from "../../infrastructure/entitlement-store.js";
import { sha256 } from "../../infrastructure/ids.js";
import { paymentLinkId, routeLegacyOrder, routePremiumDesktopAccess, type PremiumDesktopDelivery } from "../../legacy/catalog.js";
import { stripeClient } from "./client.js";

type Expandable = string | { id: string } | null | undefined;

function objectId(value: Expandable): string | undefined {
  return typeof value === "string" ? value : value?.id;
}

function customerIdFrom(value: unknown): string | undefined {
  return objectId(value as Expandable);
}

async function checkoutBuyerEmail(session: Stripe.Checkout.Session): Promise<string | undefined> {
  const inline = session.customer_details?.email ?? session.customer_email;
  if (inline) return inline.trim().toLowerCase();
  const customerId = customerIdFrom(session.customer);
  if (!customerId) return undefined;
  const customer = await stripeClient().customers.retrieve(customerId);
  if (customer.deleted || !customer.email) return undefined;
  return customer.email.trim().toLowerCase();
}

function metadataOf(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || !("metadata" in value)) return {};
  return ((value as { metadata?: Record<string, string> }).metadata) ?? {};
}

function subscriptionPeriodEnd(subscription: Stripe.Subscription): string | undefined {
  const legacy = (subscription as unknown as { current_period_end?: number }).current_period_end;
  const itemEnds = subscription.items.data
    .map((item) => (item as unknown as { current_period_end?: number }).current_period_end)
    .filter((value): value is number => typeof value === "number");
  const seconds = legacy ?? (itemEnds.length ? Math.max(...itemEnds) : undefined);
  return seconds ? new Date(seconds * 1000).toISOString() : undefined;
}

function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | undefined {
  const legacy = objectId((invoice as unknown as { subscription?: Expandable }).subscription);
  if (legacy) return legacy;
  const parent = (invoice as unknown as {
    parent?: { subscription_details?: { subscription?: Expandable } };
  }).parent;
  return objectId(parent?.subscription_details?.subscription);
}

async function uidForSubscription(store: EntitlementStore, subscription: Stripe.Subscription): Promise<string | undefined> {
  const metadata = metadataOf(subscription);
  if (metadata.wl_uid) return metadata.wl_uid;
  const linked = await store.uidForProviderSubscription("stripe", subscription.id);
  if (linked) return linked;
  const customerId = customerIdFrom(subscription.customer);
  return customerId ? store.uidForStripeCustomer(customerId) : undefined;
}

async function subscriptionContainsMonthlyProduct(store: EntitlementStore, subscription: Stripe.Subscription): Promise<boolean> {
  if (metadataOf(subscription).wl_product === "mobile_full_monthly") return true;
  const catalog = new CatalogService(store.firestore());
  const checks = await Promise.all(subscription.items.data.map((item) => catalog.recognizesMonthlyPrice(item.price.id)));
  return checks.some(Boolean);
}

async function syncSubscription(input: {
  store: EntitlementStore;
  subscriptionId: string;
  event: Stripe.Event;
  forcePaymentFailure?: boolean;
}): Promise<{ uid?: string; subscription?: Stripe.Subscription; state?: LedgerGrant["state"] }> {
  const subscription = await stripeClient().subscriptions.retrieve(input.subscriptionId);
  if (!await subscriptionContainsMonthlyProduct(input.store, subscription)) return {};
  const uid = await uidForSubscription(input.store, subscription);
  if (!uid) throw new Error(`Stripe subscription ${subscription.id} is not linked to a Firebase UID.`);
  const existing = await input.store.getGrant("stripe", subscription.id, "mobile_full_monthly");
  const now = new Date(input.event.created * 1000);
  const existingFirstFailure = existing?.metadata?.firstPaymentFailureAt;
  const firstFailureAt = typeof existingFirstFailure === "string"
    ? existingFirstFailure
    : now.toISOString();
  const graceEndsAt = stripeGraceEndsAt(new Date(firstFailureAt));
  const normalized = input.forcePaymentFailure
    ? normalizeStripeSubscriptionState({ stripeStatus: "past_due", now, graceEndsAt })
    : normalizeStripeSubscriptionState({ stripeStatus: subscription.status, now, graceEndsAt });
  const state: LedgerGrant["state"] = normalized;
  const periodEnd = subscriptionPeriodEnd(subscription);
  const customerId = customerIdFrom(subscription.customer);
  await input.store.upsertGrant({
    id: "",
    uid,
    provider: "stripe",
    ...(customerId ? { providerCustomerId: customerId } : {}),
    providerTransactionId: subscription.id,
    providerSubscriptionId: subscription.id,
    product: "mobile_full_monthly",
    state,
    startsAt: new Date(subscription.created * 1000).toISOString(),
    ...(periodEnd ? { currentPeriodEndsAt: periodEnd } : {}),
    ...(periodEnd && state === "active" ? { endsAt: periodEnd } : {}),
    ...(state === "grace" ? { graceEndsAt } : {}),
    ...(state === "expired" ? { endsAt: periodEnd ?? now.toISOString() } : {}),
    metadata: {
      stripeStatus: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      ...(subscription.trial_end ? { trialEndsAt: new Date(subscription.trial_end * 1000).toISOString() } : {}),
      ...(subscription.canceled_at ? { canceledAt: new Date(subscription.canceled_at * 1000).toISOString() } : {}),
      ...(state === "grace" ? { firstPaymentFailureAt: firstFailureAt } : {})
    }
  }, { id: input.event.id, created: input.event.created });
  return { uid, subscription, state };
}

export async function reconcileStripeSubscription(input: {
  store: EntitlementStore;
  providerSubscriptionId: string;
  eventId: string;
  eventCreated: number;
}): Promise<{ uid?: string; subscription?: Stripe.Subscription; state?: LedgerGrant["state"] }> {
  // Only id and created are consumed by syncSubscription. Provider state is
  // always retrieved fresh from Stripe before the local ledger is updated.
  const event = { id: input.eventId, created: input.eventCreated } as Stripe.Event;
  return syncSubscription({ store: input.store, subscriptionId: input.providerSubscriptionId, event });
}

async function enqueueAdConversion(input: {
  store: EntitlementStore;
  event: Stripe.Event;
  eventName: AdConversionName;
  eventSourceId: string;
  email?: string | null;
  value: number;
  currency: string;
  product: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  if (!deploymentControls().AD_CONVERSIONS_ENABLED) return;
  const context = input.context ?? {};
  const contextString = (key: string): string | undefined => {
    const value = context[key];
    return typeof value === "string" && value ? value : undefined;
  };
  const uid = contextString("uid");
  const payload = {
    eventName: input.eventName,
    eventId: input.eventSourceId,
    eventTime: input.event.created,
    eventSourceUrl: env().PUBLIC_APP_ORIGIN,
    ...(input.email ? { emailSha256: sha256(input.email.trim().toLowerCase()) } : {}),
    ...(uid ? { subjectUidHash: sha256(uid) } : {}),
    value: input.value,
    currency: input.currency.toUpperCase(),
    product: input.product,
    ...(contextString("ipAddress") ? { ipAddress: contextString("ipAddress") } : {}),
    ...(contextString("userAgent") ? { userAgent: contextString("userAgent") } : {}),
    ...(contextString("fbp") ? { fbp: contextString("fbp") } : {}),
    ...(contextString("fbc") ? { fbc: contextString("fbc") } : {}),
    ...(contextString("ttclid") ? { ttclid: contextString("ttclid") } : {}),
    ...(contextString("ttp") ? { ttp: contextString("ttp") } : {})
  };
  const now = new Date(input.event.created * 1000);
  await Promise.all([
    input.store.enqueue("meta_conversion", `meta:${input.eventSourceId}`, payload, now),
    input.store.enqueue("tiktok_conversion", `tiktok:${input.eventSourceId}`, payload, now)
  ]);
}

async function checkoutCompleted(store: EntitlementStore, session: Stripe.Checkout.Session, event: Stripe.Event): Promise<void> {
  const metadata = metadataOf(session);
  const uid = metadata.wl_uid || session.client_reference_id || undefined;
  const subscriptionId = objectId(session.subscription as Expandable);
  if (subscriptionId) await store.linkCheckoutContextToSubscription(session.id, subscriptionId, new Date(event.created * 1000));

  if (metadata.wl_product === "mobile_full_monthly") {
    if (!subscriptionId) throw new Error(`Monthly Checkout ${session.id} has no Stripe subscription.`);
    await syncSubscription({ store, subscriptionId, event });
    const decision = checkoutAdDecision({ mode: session.mode, paymentStatus: session.payment_status });
    if (decision.send && decision.eventName) {
      const context = await store.checkoutContext(session.id);
      await enqueueAdConversion({
        store,
        event,
        eventName: decision.eventName,
        eventSourceId: session.id,
        email: session.customer_details?.email ?? session.customer_email,
        value: stripeMajorValue(session.currency ?? "usd", session.amount_total ?? 0),
        currency: session.currency ?? "usd",
        product: "mobile_full_monthly",
        ...(context ? { context } : {})
      });
    }
    return;
  }

  if (metadata.wl_product === "mobile_polyglot_permanent" || metadata.wl_product === "premium_lifetime_pass") {
    if (!uid) throw new Error(`Permanent Checkout ${session.id} has no Firebase UID.`);
    if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") return;
    const product = metadata.wl_product;
    const mobilePlatform = metadata.wl_mobile_platform;
    if (mobilePlatform !== "android" && mobilePlatform !== "ios") {
      throw new Error(`Permanent Checkout ${session.id} has no valid first mobile platform.`);
    }
    const premiumDesktopDelivery = metadata.wl_desktop_delivery;
    if (product === "premium_lifetime_pass" && premiumDesktopDelivery !== "steam" && premiumDesktopDelivery !== "direct") {
      throw new Error(`Premium Checkout ${session.id} has no valid PC/Mac delivery choice.`);
    }
    const transactionId = objectId(session.payment_intent as Expandable) ?? session.id;
    const customerId = customerIdFrom(session.customer);
    await store.upsertGrant({
      id: "",
      uid,
      provider: "stripe",
      ...(customerId ? { providerCustomerId: customerId } : {}),
      providerTransactionId: transactionId,
      product,
      state: "active",
      startsAt: new Date(event.created * 1000).toISOString(),
      metadata: {
        stripeCheckoutSessionId: session.id,
        ...(product === "premium_lifetime_pass" ? { primaryMobilePlatform: mobilePlatform } : { mobilePlatform })
      }
    }, { id: event.id, created: event.created });
    if (product === "premium_lifetime_pass") {
      const buyerEmail = await checkoutBuyerEmail(session);
      if (!buyerEmail) throw new Error(`Paid Premium order ${session.id} has no customer email for PC/Mac delivery.`);
      const route = routePremiumDesktopAccess(premiumDesktopDelivery as PremiumDesktopDelivery);
      const paymentIntentId = objectId(session.payment_intent as Expandable);
      const order: LegacyOrder = {
        id: session.id,
        stripeCheckoutSessionId: session.id,
        ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
        buyerEmail,
        productCode: route.productCode,
        playMode: route.playMode,
        quantity: route.quantity,
        amountTotal: session.amount_total ?? 0,
        currency: session.currency?.toUpperCase() ?? "USD",
        paidAt: new Date(event.created * 1000).toISOString(),
        firebaseUid: uid
      };
      await store.saveLegacyOrder(order);
      await store.enqueue("fulfill_legacy_order", session.id, { ...order, sheetTab: route.sheetTab }, new Date(event.created * 1000));
    }
    if (product === "premium_lifetime_pass" && metadata.wl_legacy_discount === "1") {
      await store.redeemLegacyDiscount(uid, session.id, new Date(event.created * 1000));
    }
    if (product === "premium_lifetime_pass" && metadata.wl_cancel_stripe_subscription) {
      await store.enqueue(
        "cancel_stripe_subscription",
        `lifetime:${transactionId}:${metadata.wl_cancel_stripe_subscription}`,
        { uid, subscriptionId: metadata.wl_cancel_stripe_subscription, lifetimeTransactionId: transactionId },
        new Date(event.created * 1000)
      );
    }
    const decision = checkoutAdDecision({ mode: session.mode, paymentStatus: session.payment_status });
    if (decision.send && decision.eventName) {
      const context = await store.checkoutContext(session.id);
      await enqueueAdConversion({
        store,
        event,
        eventName: decision.eventName,
        eventSourceId: session.id,
        email: session.customer_details?.email ?? session.customer_email,
        value: stripeMajorValue(session.currency ?? "usd", session.amount_total ?? 0),
        currency: session.currency ?? "usd",
        product,
        ...(context ? { context } : {})
      });
    }
    return;
  }

  const route = routeLegacyOrder({ paymentLink: session.payment_link, customFields: session.custom_fields });
  if (!route || session.payment_status !== "paid") return;
  const buyerEmail = session.customer_details?.email ?? session.customer_email;
  if (!buyerEmail) throw new Error(`Paid legacy order ${session.id} has no customer email.`);
  const legacyPaymentLinkId = paymentLinkId(session.payment_link);
  const paymentIntentId = objectId(session.payment_intent as Expandable);
  const order: LegacyOrder = {
    id: session.id,
    stripeCheckoutSessionId: session.id,
    ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
    buyerEmail: buyerEmail.toLowerCase(),
    ...(legacyPaymentLinkId ? { paymentLinkId: legacyPaymentLinkId } : {}),
    productCode: route.productCode,
    playMode: route.playMode,
    quantity: route.quantity,
    amountTotal: session.amount_total ?? 0,
    currency: session.currency?.toUpperCase() ?? "USD",
    paidAt: new Date(event.created * 1000).toISOString(),
    ...(uid ? { firebaseUid: uid } : {})
  };
  await store.saveLegacyOrder(order);
  await store.enqueue("fulfill_legacy_order", session.id, { ...order, sheetTab: route.sheetTab }, new Date(event.created * 1000));
  const decision = checkoutAdDecision({ mode: session.mode, paymentStatus: session.payment_status });
  if (decision.send && decision.eventName) {
    const context = await store.checkoutContext(session.id);
    await enqueueAdConversion({
      store,
      event,
      eventName: decision.eventName,
      eventSourceId: session.id,
      email: buyerEmail,
      value: stripeMajorValue(session.currency ?? "usd", session.amount_total ?? 0),
      currency: session.currency ?? "usd",
      product: route.productCode,
      ...(context ? { context } : {})
    });
  }
}

async function invoicePaid(store: EntitlementStore, invoice: Stripe.Invoice, event: Stripe.Event): Promise<void> {
  const subscriptionId = subscriptionIdFromInvoice(invoice);
  if (!subscriptionId) return;
  await syncSubscription({ store, subscriptionId, event });
  const decision = stripeInvoiceAdDecision({
    billingReason: invoice.billing_reason,
    paid: invoice.status === "paid",
    amountPaid: invoice.amount_paid
  });
  if (!decision.send || !decision.eventName) return;
  let context = await store.subscriptionContext(subscriptionId);
  if (!context) {
    const sessions = await stripeClient().checkout.sessions.list({ subscription: subscriptionId, limit: 1 });
    const session = sessions.data[0];
    if (session) {
      await store.linkCheckoutContextToSubscription(session.id, subscriptionId, new Date(event.created * 1000));
      context = await store.subscriptionContext(subscriptionId);
    }
  }
  await enqueueAdConversion({
    store,
    event,
    eventName: decision.eventName,
    eventSourceId: invoice.id ?? event.id,
    email: invoice.customer_email,
    value: stripeMajorValue(invoice.currency, invoice.amount_paid),
    currency: invoice.currency,
    product: "mobile_full_monthly",
    ...(context ? { context } : {})
  });
}

export async function processStripeEvent(store: EntitlementStore, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await checkoutCompleted(store, event.data.object as Stripe.Checkout.Session, event);
      return;
    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;
      const metadata = metadataOf(session);
      if (metadata.wl_uid && metadata.wl_legacy_discount === "1") {
        await store.releaseLegacyDiscount(metadata.wl_uid, session.id, new Date(event.created * 1000));
      }
      return;
    }
    case "invoice.paid":
      await invoicePaid(store, event.data.object as Stripe.Invoice, event);
      return;
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = subscriptionIdFromInvoice(invoice);
      if (subscriptionId) await syncSubscription({ store, subscriptionId, event, forcePaymentFailure: true });
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      await syncSubscription({ store, subscriptionId: (event.data.object as Stripe.Subscription).id, event });
      return;
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      if (!charge.refunded && charge.amount_refunded < charge.amount) return;
      const transactionId = objectId(charge.payment_intent as Expandable);
      if (transactionId) {
        await store.revokeByProviderTransaction({
          provider: "stripe",
          providerTransactionId: transactionId,
          state: "refunded",
          sourceEvent: { id: event.id, created: event.created },
          at: new Date(event.created * 1000)
        });
      }
      return;
    }
    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      const charge = typeof dispute.charge === "string"
        ? await stripeClient().charges.retrieve(dispute.charge)
        : dispute.charge;
      const transactionId = charge && objectId(charge.payment_intent as Expandable);
      if (transactionId) {
        await store.revokeByProviderTransaction({
          provider: "stripe",
          providerTransactionId: transactionId,
          state: "revoked",
          sourceEvent: { id: event.id, created: event.created },
          at: new Date(event.created * 1000)
        });
      }
      return;
    }
    default:
      return;
  }
}
