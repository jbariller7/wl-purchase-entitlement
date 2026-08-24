import type { Firestore } from "firebase-admin/firestore";
import type Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { CatalogService, type CatalogOfferKind } from "../catalog/service.js";
import { env } from "../config/env.js";
import { EntitlementStore } from "../infrastructure/entitlement-store.js";
import { stripeClient } from "../providers/stripe/client.js";
import { recordAdminAudit, type AdminActor } from "./audit.js";
import { HttpError } from "../http/auth.js";

type RefundReason = "duplicate" | "fraudulent" | "requested_by_customer";

function phraseAmount(amount: number, currency: string): string {
  return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

async function chargeForPaymentIntent(payment: Stripe.PaymentIntent): Promise<Stripe.Charge> {
  const charge = payment.latest_charge;
  if (!charge) throw new HttpError(409, "This PaymentIntent has no completed charge to refund.");
  return typeof charge === "string" ? stripeClient().charges.retrieve(charge) : charge;
}

export class AdminBillingService {
  private readonly catalog: CatalogService;
  private readonly store: EntitlementStore;

  constructor(private readonly db: Firestore) {
    this.catalog = new CatalogService(db);
    this.store = new EntitlementStore(db);
  }

  async catalogStatus(): Promise<Record<string, unknown>> {
    const catalog = await this.catalog.get();
    return {
      ...catalog,
      notes: {
        priceChangesAffect: "new_checkouts_only",
        existingSubscriptions: "keep_their_existing_stripe_price",
        oldPrices: "retained_for_existing_subscriptions_and_webhook_history"
      }
    };
  }

  async previewPriceChange(input: {
    actor: AdminActor;
    kind: CatalogOfferKind;
    unitAmount: number;
    currency: string;
    now: Date;
  }): Promise<Record<string, unknown>> {
    if (!Number.isSafeInteger(input.unitAmount) || input.unitAmount < 50 || input.unitAmount > 500_000) {
      throw new HttpError(400, "Enter a valid price between 0.50 and 5,000.00.");
    }
    const currency = input.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, "Currency must be a three-letter ISO code.");
    const catalog = await this.catalog.get();
    const current = input.kind === "monthly" ? catalog.monthly : catalog.lifetime;
    if (current.unitAmount === input.unitAmount && current.currency === currency) throw new HttpError(409, "The proposed price is already active.");
    const id = randomUUID();
    const confirmationPhrase = `CHANGE ${input.kind.toUpperCase()} TO ${phraseAmount(input.unitAmount, currency)}`;
    const expiresAt = new Date(input.now.getTime() + 15 * 60 * 1000);
    await this.db.collection("adminPricePreviews").doc(id).create({
      id,
      actorUid: input.actor.uid,
      kind: input.kind,
      unitAmount: input.unitAmount,
      currency,
      expectedRevision: catalog.revision,
      current,
      confirmationPhrase,
      state: "preview",
      createdAt: input.now.toISOString(),
      expiresAt: expiresAt.toISOString()
    });
    return {
      previewId: id,
      kind: input.kind,
      current,
      proposed: { unitAmount: input.unitAmount, currency, recurring: input.kind === "monthly" },
      confirmationPhrase,
      expiresAt: expiresAt.toISOString(),
      affectsExistingSubscriptions: false,
      warning: "Stripe prices are immutable. Confirming creates a new Price for future checkouts; existing subscribers keep their current price."
    };
  }

  async commitPriceChange(input: { actor: AdminActor; previewId: string; confirmationPhrase: string; now: Date }): Promise<Record<string, unknown>> {
    if (!env().STRIPE_MUTATIONS_ENABLED) throw new HttpError(409, "Stripe mutations are disabled for this deployment.");
    const ref = this.db.collection("adminPricePreviews").doc(input.previewId);
    const preview = await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new HttpError(404, "Price preview not found.");
      const data = snapshot.data() as Record<string, unknown>;
      if (data.actorUid !== input.actor.uid) throw new HttpError(403, "This preview belongs to another administrator.");
      if (data.state === "complete") return data;
      if (data.state !== "preview") throw new HttpError(409, "This price change is already processing.");
      if (Date.parse(String(data.expiresAt)) <= input.now.getTime()) throw new HttpError(410, "Price preview expired. Create a fresh preview.");
      if (input.confirmationPhrase.trim() !== data.confirmationPhrase) throw new HttpError(400, "The confirmation phrase does not match.");
      transaction.update(ref, { state: "processing", processingAt: input.now.toISOString() });
      return data;
    });
    if (preview.state === "complete") return preview.result as Record<string, unknown>;
    try {
      const result = await this.catalog.changePrice({
        kind: preview.kind as CatalogOfferKind,
        unitAmount: Number(preview.unitAmount),
        currency: String(preview.currency),
        expectedRevision: Number(preview.expectedRevision),
        actorUid: input.actor.uid,
        now: input.now
      });
      await ref.update({ state: "complete", completedAt: new Date().toISOString(), result });
      await recordAdminAudit({
        db: this.db, actor: input.actor, action: "catalog.price.change", targetType: "catalog", targetId: String(preview.kind),
        summary: `Changed ${preview.kind} price for new checkouts`, metadata: { unitAmount: preview.unitAmount, currency: preview.currency, revision: result.revision }, now: input.now
      });
      return result as unknown as Record<string, unknown>;
    } catch (error) {
      await ref.update({ state: "failed", failedAt: new Date().toISOString(), lastError: error instanceof Error ? error.message : "Unknown error" }).catch(() => undefined);
      throw error;
    }
  }

  async previewRefund(input: {
    actor: AdminActor;
    uid: string;
    paymentIntentId: string;
    amount?: number;
    reason: RefundReason;
    note: string;
    now: Date;
  }): Promise<Record<string, unknown>> {
    if (input.note.trim().length < 10) throw new HttpError(400, "A clear refund note of at least ten characters is required.");
    const customerId = await this.store.stripeCustomerId(input.uid);
    if (!customerId) throw new HttpError(404, "This account has no linked Stripe customer.");
    const payment = await stripeClient().paymentIntents.retrieve(input.paymentIntentId, { expand: ["latest_charge"] }).catch(() => {
      throw new HttpError(404, "Stripe payment was not found in this environment.");
    });
    const paymentCustomer = typeof payment.customer === "string" ? payment.customer : payment.customer?.id;
    if (paymentCustomer !== customerId) throw new HttpError(403, "The payment does not belong to this WonderLang account.");
    const charge = await chargeForPaymentIntent(payment);
    const refundable = Math.max(0, charge.amount - charge.amount_refunded);
    const amount = input.amount ?? refundable;
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > refundable) throw new HttpError(400, `Refund amount must be between 1 and ${refundable} minor currency units.`);
    const id = randomUUID();
    const confirmationPhrase = `REFUND ${phraseAmount(amount, payment.currency)}`;
    const expiresAt = new Date(input.now.getTime() + 15 * 60 * 1000);
    await this.db.collection("adminRefundPreviews").doc(id).create({
      id,
      actorUid: input.actor.uid,
      uid: input.uid,
      stripeCustomerId: customerId,
      paymentIntentId: payment.id,
      chargeId: charge.id,
      amount,
      currency: payment.currency.toUpperCase(),
      refundableBefore: refundable,
      reason: input.reason,
      note: input.note.trim(),
      confirmationPhrase,
      state: "preview",
      createdAt: input.now.toISOString(),
      expiresAt: expiresAt.toISOString()
    });
    return {
      previewId: id,
      uid: input.uid,
      paymentIntentId: payment.id,
      amount,
      currency: payment.currency.toUpperCase(),
      refundableBefore: refundable,
      confirmationPhrase,
      expiresAt: expiresAt.toISOString(),
      warnings: [
        "A refund does not cancel an active subscription.",
        amount === charge.amount ? "A full lifetime-payment refund revokes its entitlement when Stripe delivers the webhook." : "A partial refund does not revoke the entitlement automatically.",
        "Delivered Steam/Itch keys are never returned to inventory automatically."
      ]
    };
  }

  async commitRefund(input: { actor: AdminActor; previewId: string; confirmationPhrase: string; now: Date }): Promise<Record<string, unknown>> {
    if (!env().STRIPE_MUTATIONS_ENABLED) throw new HttpError(409, "Stripe mutations are disabled for this deployment.");
    const ref = this.db.collection("adminRefundPreviews").doc(input.previewId);
    const preview = await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new HttpError(404, "Refund preview not found.");
      const data = snapshot.data() as Record<string, unknown>;
      if (data.actorUid !== input.actor.uid) throw new HttpError(403, "This preview belongs to another administrator.");
      if (data.state === "complete") return data;
      if (data.state !== "preview") throw new HttpError(409, "This refund is already processing.");
      if (Date.parse(String(data.expiresAt)) <= input.now.getTime()) throw new HttpError(410, "Refund preview expired. Create a fresh preview.");
      if (input.confirmationPhrase.trim() !== data.confirmationPhrase) throw new HttpError(400, "The confirmation phrase does not match.");
      transaction.update(ref, { state: "processing", processingAt: input.now.toISOString() });
      return data;
    });
    if (preview.state === "complete") return preview.result as Record<string, unknown>;
    try {
      const refund = await stripeClient().refunds.create({
        payment_intent: String(preview.paymentIntentId),
        amount: Number(preview.amount),
        reason: preview.reason as RefundReason,
        metadata: {
          wl_admin_uid: input.actor.uid,
          wl_account_uid: String(preview.uid),
          wl_admin_note: String(preview.note).slice(0, 450)
        }
      }, { idempotencyKey: `admin-refund-${input.previewId}` });
      const result = { refundId: refund.id, status: refund.status, amount: refund.amount, currency: refund.currency.toUpperCase() };
      await ref.update({ state: "complete", completedAt: new Date().toISOString(), result });
      await recordAdminAudit({
        db: this.db, actor: input.actor, action: "stripe.refund.create", targetType: "paymentIntent", targetId: String(preview.paymentIntentId),
        summary: `Refunded ${phraseAmount(Number(preview.amount), String(preview.currency))}`, metadata: { uid: preview.uid, refundId: refund.id, reason: preview.reason, note: preview.note }, now: input.now
      });
      return result;
    } catch (error) {
      await ref.update({ state: "failed", failedAt: new Date().toISOString(), lastError: error instanceof Error ? error.message : "Unknown error" }).catch(() => undefined);
      throw error;
    }
  }
}
