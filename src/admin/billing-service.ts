import type { Firestore } from "firebase-admin/firestore";
import type Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { WebsiteCatalogService, assertDesktopKind, proposedWebsitePrices, type DesktopKind } from "../catalog/website-service.js";
import { deploymentControls } from "../config/env.js";
import { EntitlementStore } from "../infrastructure/entitlement-store.js";
import { stripeClient } from "../providers/stripe/client.js";
import { websiteStripeClient } from '../providers/stripe/website-config.js';
import { ownedWebsitePayment } from '../providers/stripe/website-admin-payments.js';
import { recordAdminAudit, type AdminActor } from "./audit.js";
import { HttpError } from "../http/auth.js";
import { LEGACY_CHAPTER_FULL_UPGRADE_CUTOFF } from "../domain/catalog.js";
import { stripeMajorAmount, stripeMinorAmount } from "../domain/regional-pricing.js";
import { safeErrorMessage } from "../infrastructure/safe-error.js";

type RefundReason = "duplicate" | "fraudulent" | "requested_by_customer";

function phraseAmount(amount: number, currency: string): string {
  return `${stripeMajorAmount(currency, amount)} ${currency.toUpperCase()}`;
}

export function priceChangeConfirmationPhrase(kind: DesktopKind, unitAmount: number, currency: string): string {
  return `CHANGE ${kind.toUpperCase()} TO ${phraseAmount(unitAmount, currency)}`;
}

export function assertWebsiteStripePriceKind(kind: string): asserts kind is DesktopKind { assertDesktopKind(kind); }

async function chargeForPaymentIntent(payment: Stripe.PaymentIntent, client:Stripe = stripeClient()): Promise<Stripe.Charge> {
  const charge = payment.latest_charge;
  if (!charge) throw new HttpError(409, "This PaymentIntent has no completed charge to refund.");
  return typeof charge === "string" ? client.charges.retrieve(charge) : charge;
}

export class AdminBillingService {
  private readonly catalog: WebsiteCatalogService;
  private readonly store: EntitlementStore;

  constructor(private readonly db: Firestore) {
    this.catalog = new WebsiteCatalogService(db);
    this.store = new EntitlementStore(db);
  }

  async catalogStatus(): Promise<Record<string, unknown>> {
    const catalog = await this.catalog.status();
    return {
      ...catalog,
      notes: {
        priceChangesAffect: "new_checkouts_only",
        existingSubscriptions: "keep_their_existing_stripe_price",
        oldPrices: "retained_for_existing_subscriptions_and_webhook_history",
        legacyChapterUpgradeCutoff: LEGACY_CHAPTER_FULL_UPGRADE_CUTOFF
      }
    };
  }

  async previewPriceChange(input: {
    actor: AdminActor;
    kind: DesktopKind;
    unitAmount?: number;
    currency?: string;
    percentChange?: number;
    now: Date;
  }): Promise<Record<string, unknown>> {
    assertWebsiteStripePriceKind(input.kind);
    const live = await this.catalog.get();
    const currency=input.currency?.toUpperCase();
    const proposedPrices = proposedWebsitePrices(live.prices,input.kind,input);
    const current = Object.fromEntries(Object.entries(live.prices).map(([code,amounts])=>[code,amounts[['single','polyglot','premium'].indexOf(input.kind)]!]));
    const changes=Object.entries(proposedPrices).filter(([code])=>input.percentChange!==undefined||code===currency).map(([currency,amount])=>({currency,before:current[currency],after:amount}));
    if(!changes.some(c=>stripeMinorAmount(c.currency,c.before!)!==stripeMinorAmount(c.currency,c.after)))throw new HttpError(409,'These prices are already active after currency rounding.');
    const id=randomUUID();
    const confirmationPhrase=input.percentChange!==undefined?`CHANGE ${input.kind.toUpperCase()} BY ${input.percentChange}%`:priceChangeConfirmationPhrase(input.kind,input.unitAmount!,currency!);
    const expiresAt = new Date(input.now.getTime() + 15 * 60 * 1000);
    await this.db.collection("adminPricePreviews").doc(id).create({
      id,
      actorUid: input.actor.uid,
      kind: input.kind,
      ...(input.percentChange!==undefined?{percentChange:input.percentChange}:{unitAmount:input.unitAmount,currency}),
      expectedRevision: live.revision,
      catalogSource: "website",
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
      proposed: proposedPrices,
      changes,
      confirmationPhrase,
      expiresAt: expiresAt.toISOString(),
      affectsExistingSubscriptions: false,
      warning: "Confirming updates the listed prices for this product for new website and demo checkouts, including sale links. Unlisted currencies, mobile products, open checkouts and past purchases remain unchanged."
    };
  }

  async commitPriceChange(input: { actor: AdminActor; previewId: string; confirmationPhrase: string; now: Date }): Promise<Record<string, unknown>> {
    const ref = this.db.collection("adminPricePreviews").doc(input.previewId);
    const preview = await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new HttpError(404, "Price preview not found.");
      const data = snapshot.data() as Record<string, unknown>;
      assertWebsiteStripePriceKind(data.kind as DesktopKind);
      if(data.catalogSource!=="website")throw new HttpError(409,"Create a new preview for the live website catalogue.");
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
        kind: preview.kind as DesktopKind,
        ...(preview.percentChange!==undefined?{percentChange:Number(preview.percentChange)}:{unitAmount:Number(preview.unitAmount),currency:String(preview.currency)}),
        expectedRevision: Number(preview.expectedRevision),
        actorUid: input.actor.uid,
        now: input.now
      });
      await ref.update({ state: "complete", completedAt: new Date().toISOString(), result });
      await recordAdminAudit({
        db: this.db, actor: input.actor, action: "catalog.price.change", targetType: "catalog", targetId: String(preview.kind),
        summary: `Changed ${preview.kind} price for new checkouts`, metadata: { ...(preview.percentChange!==undefined?{percentChange:preview.percentChange}:{unitAmount:preview.unitAmount,currency:preview.currency}), revision: result.revision }, now: input.now
      });
      return result as unknown as Record<string, unknown>;
    } catch (error) {
      await ref.update({ state: "failed", failedAt: new Date().toISOString(), lastError: safeErrorMessage(error, "Unknown error") }).catch(() => undefined);
      throw error;
    }
  }

  async previewRefund(input: {
    websitePayment?: boolean;
    actor: AdminActor;
    uid: string;
    paymentIntentId: string;
    amount?: number;
    reason: RefundReason;
    note: string;
    now: Date;
  }): Promise<Record<string, unknown>> {
    if (input.note.trim().length < 10) throw new HttpError(400, "A clear refund note of at least ten characters is required.");
    const liveWebsite=input.websitePayment===true;
    const client=liveWebsite?websiteStripeClient():stripeClient();
    const customerId = liveWebsite?undefined:await this.store.stripeCustomerId(input.uid);
    if (!liveWebsite&&!customerId) throw new HttpError(404, "This account has no linked Stripe customer.");
    const payment = liveWebsite?await ownedWebsitePayment(this.db,input.uid,input.paymentIntentId):await client.paymentIntents.retrieve(input.paymentIntentId, { expand: ["latest_charge"] }).catch(() => {
      throw new HttpError(404, "Stripe payment was not found in this environment.");
    });
    const paymentCustomer = typeof payment.customer === "string" ? payment.customer : payment.customer?.id;
    if (!liveWebsite&&paymentCustomer !== customerId) throw new HttpError(403, "The payment does not belong to this WonderLang account.");
    const charge = await chargeForPaymentIntent(payment,client);
    const refundable = Math.max(0, charge.amount - charge.amount_refunded);
    const amount = input.amount ?? refundable;
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > refundable) throw new HttpError(400, `Refund amount must be between 1 and ${refundable} minor currency units.`);
    const id = randomUUID();
    const confirmationPhrase = `${liveWebsite?'LIVE ':''}REFUND ${phraseAmount(amount, payment.currency)}`;
    const expiresAt = new Date(input.now.getTime() + 15 * 60 * 1000);
    await this.db.collection("adminRefundPreviews").doc(id).create({
      id,
      actorUid: input.actor.uid,
      uid: input.uid,
      stripeCustomerId: paymentCustomer??null,
      websitePayment: liveWebsite,
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
        liveWebsite ? "LIVE PAYMENT: this returns real money to the customer." : "Refund uses the original Stripe environment.",
        amount === refundable ? "A fully refunded one-time purchase loses access after Stripe's webhook. A subscription refund does not cancel the subscription." : "A partial refund does not revoke the entitlement automatically.",
        "Delivered Steam/Itch keys are never returned to inventory automatically."
      ]
    };
  }

  async commitRefund(input: { actor: AdminActor; previewId: string; confirmationPhrase: string; now: Date }): Promise<Record<string, unknown>> {
    const ref = this.db.collection("adminRefundPreviews").doc(input.previewId);
    const preview = await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new HttpError(404, "Refund preview not found.");
      const data = snapshot.data() as Record<string, unknown>;
      if (data.actorUid !== input.actor.uid) throw new HttpError(403, "This preview belongs to another administrator.");
      if(data.websitePayment!==true&&!deploymentControls().STRIPE_MUTATIONS_ENABLED)throw new HttpError(409,'Stripe mutations are disabled for this deployment.');
      if (data.state === "complete") return data;
      if (data.state !== "preview") throw new HttpError(409, "This refund is already processing.");
      if (Date.parse(String(data.expiresAt)) <= input.now.getTime()) throw new HttpError(410, "Refund preview expired. Create a fresh preview.");
      if (input.confirmationPhrase.trim() !== data.confirmationPhrase) throw new HttpError(400, "The confirmation phrase does not match.");
      transaction.update(ref, { state: "processing", processingAt: input.now.toISOString() });
      return data;
    });
    if (preview.state === "complete") return preview.result as Record<string, unknown>;
    try {
      const client=preview.websitePayment===true?websiteStripeClient():stripeClient();
      if(preview.websitePayment===true)await ownedWebsitePayment(this.db,String(preview.uid),String(preview.paymentIntentId));
      const refund = await client.refunds.create({
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
      await ref.update({ state: "failed", failedAt: new Date().toISOString(), lastError: safeErrorMessage(error, "Unknown error") }).catch(() => undefined);
      throw error;
    }
  }
}
