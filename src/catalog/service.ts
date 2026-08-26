import type { Firestore } from "firebase-admin/firestore";
import type Stripe from "stripe";
import { stripeEnv } from "../config/env.js";
import { stripeClient } from "../providers/stripe/client.js";
import { REGIONAL_PRICES, stripeMinorAmount, type OfferPriceKind } from "../domain/regional-pricing.js";

export type CatalogOfferKind = OfferPriceKind;

export interface CatalogOffer {
  stripePriceId: string;
  unitAmount: number;
  currency: string;
  recurring: boolean;
}

export interface CatalogConfiguration {
  revision: number;
  monthly: CatalogOffer;
  polyglot: CatalogOffer;
  premium: CatalogOffer;
  monthlyPriceHistory: string[];
  polyglotPriceHistory: string[];
  premiumPriceHistory: string[];
  regionalPrices: Record<CatalogOfferKind, Record<string, string>>;
  updatedAt?: string;
  updatedBy?: string;
}

export interface PublicCatalogConfiguration {
  revision: number;
  monthly: Pick<CatalogOffer, "unitAmount" | "currency" | "recurring">;
  polyglot: Pick<CatalogOffer, "unitAmount" | "currency" | "recurring">;
  premium: Pick<CatalogOffer, "unitAmount" | "currency" | "recurring">;
  regionalPrices: Record<CatalogOfferKind, Record<string, string>>;
}

function priceProductId(price: Stripe.Price): string {
  return typeof price.product === "string" ? price.product : price.product.id;
}

function asOffer(price: Stripe.Price, kind: CatalogOfferKind): CatalogOffer {
  if (!price.active || price.unit_amount == null) throw new Error(`Stripe Price ${price.id} is inactive or has no fixed amount.`);
  if (kind === "monthly" && (price.type !== "recurring" || price.recurring?.interval !== "month")) {
    throw new Error(`Stripe Price ${price.id} must recur monthly.`);
  }
  if (kind !== "monthly" && price.type === "recurring") {
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

  async getPublic(fallback: PublicCatalogConfiguration): Promise<PublicCatalogConfiguration> {
    const snapshot = await this.ref().get();
    if (!snapshot.exists) return fallback;
    const stored = snapshot.data() as Partial<CatalogConfiguration>;
    const publicOffer = (
      offer: CatalogOffer | undefined,
      defaultOffer: PublicCatalogConfiguration[CatalogOfferKind]
    ): PublicCatalogConfiguration[CatalogOfferKind] => {
      if (!offer || !Number.isSafeInteger(offer.unitAmount) || offer.unitAmount < 1 || !/^[A-Za-z]{3}$/.test(offer.currency)) {
        return defaultOffer;
      }
      return {
        unitAmount: offer.unitAmount,
        currency: offer.currency.toUpperCase(),
        recurring: offer.recurring
      };
    };
    return {
      revision: Number.isSafeInteger(stored.revision) && Number(stored.revision) >= 0 ? Number(stored.revision) : fallback.revision,
      monthly: publicOffer(stored.monthly, fallback.monthly),
      polyglot: publicOffer(stored.polyglot, fallback.polyglot),
      premium: publicOffer(stored.premium, fallback.premium),
      regionalPrices: {
        monthly: { ...fallback.regionalPrices.monthly, ...(stored.regionalPrices?.monthly ?? {}) },
        polyglot: { ...fallback.regionalPrices.polyglot, ...(stored.regionalPrices?.polyglot ?? {}) },
        premium: { ...fallback.regionalPrices.premium, ...(stored.regionalPrices?.premium ?? {}) }
      }
    };
  }

  async get(): Promise<CatalogConfiguration> {
    const snapshot = await this.ref().get();
    const stored = snapshot.exists ? snapshot.data() as Partial<CatalogConfiguration> & {
      lifetime?: CatalogOffer;
      lifetimePriceHistory?: string[];
    } : {};
    const [monthlyPrice, polyglotPrice, premiumPrice] = await Promise.all([
      stored.monthly ? undefined : stripeClient().prices.retrieve(stripeEnv().STRIPE_PRICE_MOBILE_MONTHLY),
      stored.polyglot ? undefined : stripeClient().prices.retrieve(stripeEnv().STRIPE_PRICE_POLYGLOT_PERMANENT),
      stored.premium ? undefined : stripeClient().prices.retrieve(stripeEnv().STRIPE_PRICE_PREMIUM_LIFETIME)
    ]);
    const monthly = stored.monthly ?? asOffer(monthlyPrice as Stripe.Price, "monthly");
    const polyglot = stored.polyglot ?? asOffer(polyglotPrice as Stripe.Price, "polyglot");
    const premium = stored.premium ?? asOffer(premiumPrice as Stripe.Price, "premium");
    return {
      revision: Number(stored.revision ?? 0),
      monthly,
      polyglot,
      premium,
      monthlyPriceHistory: [...new Set([...(stored.monthlyPriceHistory ?? []), monthly.stripePriceId])],
      polyglotPriceHistory: [...new Set([...(stored.polyglotPriceHistory ?? []), polyglot.stripePriceId])],
      premiumPriceHistory: [...new Set([
        ...(stored.premiumPriceHistory ?? []),
        ...(stored.lifetimePriceHistory ?? []),
        premium.stripePriceId
      ])],
      regionalPrices: {
        monthly: { ...REGIONAL_PRICES.monthly, ...(stored.regionalPrices?.monthly ?? {}) },
        polyglot: { ...REGIONAL_PRICES.polyglot, ...(stored.regionalPrices?.polyglot ?? {}) },
        premium: { ...REGIONAL_PRICES.premium, ...(stored.regionalPrices?.premium ?? {}) }
      },
      ...(stored.updatedAt ? { updatedAt: stored.updatedAt } : {}),
      ...(stored.updatedBy ? { updatedBy: stored.updatedBy } : {})
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
    if (!Number.isSafeInteger(input.unitAmount) || input.unitAmount < 1 || input.unitAmount > 100_000_000) {
      throw new Error("Price must be a positive Stripe amount in the currency's smallest unit.");
    }
    const currency = input.currency.trim().toLowerCase();
    if (!/^[a-z]{3}$/.test(currency)) throw new Error("Currency must be a three-letter ISO code.");
    const current = await this.get();
    if (current.revision !== input.expectedRevision) throw new Error("Catalog changed since preview. Refresh and review the new values.");
    const oldOffer = current[input.kind];
    const oldPrice = await stripeClient().prices.retrieve(oldOffer.stripePriceId);
    const nextRegionalPrices = {
      ...current.regionalPrices[input.kind],
      [input.currency.toUpperCase()]: (input.unitAmount / (input.currency.toUpperCase() === "CLP" || input.currency.toUpperCase() === "JPY" || input.currency.toUpperCase() === "KRW" || input.currency.toUpperCase() === "VND" ? 1 : 100)).toFixed(
        input.currency.toUpperCase() === "CLP" || input.currency.toUpperCase() === "JPY" || input.currency.toUpperCase() === "KRW" || input.currency.toUpperCase() === "VND" ? 0 : 2
      )
    };
    const usdPrice = nextRegionalPrices.USD;
    if (!usdPrice) throw new Error("Every WonderLang Price must keep a USD currency option.");
    const defaultAmount = stripeMinorAmount("USD", usdPrice);
    const currencyOptions = Object.fromEntries(
      Object.entries(nextRegionalPrices)
        .filter(([code]) => code !== "USD")
        .map(([code, amount]) => [code.toLowerCase(), { unit_amount: stripeMinorAmount(code, amount) }])
    );
    const created = await stripeClient().prices.create({
      product: priceProductId(oldPrice),
      unit_amount: defaultAmount,
      currency: "usd",
      currency_options: currencyOptions,
      ...(input.kind === "monthly" ? { recurring: { interval: "month" } } : {}),
      metadata: {
        wl_product: input.kind === "monthly" ? "mobile_full_monthly"
          : input.kind === "polyglot" ? "mobile_polyglot_permanent" : "premium_lifetime_pass",
        wl_catalog_revision: String(current.revision + 1),
        wl_changed_by: input.actorUid
      }
    }, { idempotencyKey: `catalog-${input.kind}-${current.revision + 1}-${input.unitAmount}-${currency}` });
    const offer = asOffer(created, input.kind);
    const next: CatalogConfiguration = {
      ...current,
      revision: current.revision + 1,
      [input.kind]: offer,
      ...(input.kind === "monthly" ? {
        monthlyPriceHistory: [...new Set([...current.monthlyPriceHistory, offer.stripePriceId])]
      } : input.kind === "polyglot" ? {
        polyglotPriceHistory: [...new Set([...current.polyglotPriceHistory, offer.stripePriceId])]
      } : {
        premiumPriceHistory: [...new Set([...current.premiumPriceHistory, offer.stripePriceId])]
      }),
      regionalPrices: { ...current.regionalPrices, [input.kind]: nextRegionalPrices },
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
