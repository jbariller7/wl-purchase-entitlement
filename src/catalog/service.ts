import type { Firestore } from "firebase-admin/firestore";
import type Stripe from "stripe";
import { env } from "../config/env.js";
import { stripeClient } from "../providers/stripe/client.js";

export type CatalogOfferKind = "monthly" | "lifetime";

export interface CatalogOffer {
  stripePriceId: string;
  unitAmount: number;
  currency: string;
  recurring: boolean;
}

export interface CatalogConfiguration {
  revision: number;
  monthly: CatalogOffer;
  lifetime: CatalogOffer;
  monthlyPriceHistory: string[];
  lifetimePriceHistory: string[];
  updatedAt?: string;
  updatedBy?: string;
}

function priceProductId(price: Stripe.Price): string {
  return typeof price.product === "string" ? price.product : price.product.id;
}

function asOffer(price: Stripe.Price, kind: CatalogOfferKind): CatalogOffer {
  if (!price.active || price.unit_amount == null) throw new Error(`Stripe Price ${price.id} is inactive or has no fixed amount.`);
  if (kind === "monthly" && (price.type !== "recurring" || price.recurring?.interval !== "month")) {
    throw new Error(`Stripe Price ${price.id} must recur monthly.`);
  }
  if (kind === "lifetime" && price.type === "recurring") {
    throw new Error(`Stripe Price ${price.id} must be a one-time Price.`);
  }
  return {
    stripePriceId: price.id,
    unitAmount: price.unit_amount,
    currency: price.currency.toUpperCase(),
    recurring: price.type === "recurring"
  };
}

export class CatalogService {
  constructor(private readonly db: Firestore) {}

  private ref() { return this.db.collection("configuration").doc("catalog"); }

  async get(): Promise<CatalogConfiguration> {
    const snapshot = await this.ref().get();
    if (snapshot.exists) return snapshot.data() as CatalogConfiguration;
    const [monthlyPrice, lifetimePrice] = await Promise.all([
      stripeClient().prices.retrieve(env().STRIPE_PRICE_MOBILE_MONTHLY),
      stripeClient().prices.retrieve(env().STRIPE_PRICE_MOBILE_LIFETIME)
    ]);
    const monthly = asOffer(monthlyPrice, "monthly");
    const lifetime = asOffer(lifetimePrice, "lifetime");
    return {
      revision: 0,
      monthly,
      lifetime,
      monthlyPriceHistory: [monthly.stripePriceId],
      lifetimePriceHistory: [lifetime.stripePriceId]
    };
  }

  async recognizesMonthlyPrice(priceId: string): Promise<boolean> {
    const catalog = await this.get();
    return catalog.monthlyPriceHistory.includes(priceId) || priceId === catalog.monthly.stripePriceId;
  }

  async changePrice(input: {
    kind: CatalogOfferKind;
    unitAmount: number;
    currency: string;
    expectedRevision: number;
    actorUid: string;
    now: Date;
  }): Promise<CatalogConfiguration> {
    if (!Number.isSafeInteger(input.unitAmount) || input.unitAmount < 50 || input.unitAmount > 500_000) {
      throw new Error("Price must be between 0.50 and 5,000.00 in the smallest currency unit.");
    }
    const currency = input.currency.trim().toLowerCase();
    if (!/^[a-z]{3}$/.test(currency)) throw new Error("Currency must be a three-letter ISO code.");
    const current = await this.get();
    if (current.revision !== input.expectedRevision) throw new Error("Catalog changed since preview. Refresh and review the new values.");
    const oldOffer = input.kind === "monthly" ? current.monthly : current.lifetime;
    const oldPrice = await stripeClient().prices.retrieve(oldOffer.stripePriceId);
    const created = await stripeClient().prices.create({
      product: priceProductId(oldPrice),
      unit_amount: input.unitAmount,
      currency,
      ...(input.kind === "monthly" ? { recurring: { interval: "month" } } : {}),
      metadata: {
        wl_product: input.kind === "monthly" ? "mobile_full_monthly" : "mobile_full_lifetime",
        wl_catalog_revision: String(current.revision + 1),
        wl_changed_by: input.actorUid
      }
    }, { idempotencyKey: `catalog-${input.kind}-${current.revision + 1}-${input.unitAmount}-${currency}` });
    const offer = asOffer(created, input.kind);
    const next: CatalogConfiguration = {
      ...current,
      revision: current.revision + 1,
      ...(input.kind === "monthly" ? {
        monthly: offer,
        monthlyPriceHistory: [...new Set([...current.monthlyPriceHistory, offer.stripePriceId])]
      } : {
        lifetime: offer,
        lifetimePriceHistory: [...new Set([...current.lifetimePriceHistory, offer.stripePriceId])]
      }),
      updatedAt: input.now.toISOString(),
      updatedBy: input.actorUid
    };
    try {
      await this.db.runTransaction(async (transaction) => {
        const fresh = await transaction.get(this.ref());
        const revision = fresh.exists ? Number(fresh.data()?.revision ?? 0) : 0;
        if (revision !== input.expectedRevision) throw new Error("Catalog changed while the new Stripe Price was being created.");
        transaction.set(this.ref(), next);
      });
    } catch (error) {
      await stripeClient().prices.update(created.id, { active: false }).catch(() => undefined);
      throw error;
    }
    return next;
  }
}
