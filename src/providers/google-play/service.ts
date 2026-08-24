import { google, type androidpublisher_v3 } from "googleapis";
import { env } from "../../config/env.js";
import { LEGACY_PLAY_PRODUCT_MAP } from "../../domain/catalog.js";
import type { EffectiveEntitlements, LedgerGrant } from "../../domain/model.js";
import { HttpError } from "../../http/auth.js";
import type { EntitlementStore } from "../../infrastructure/entitlement-store.js";
import { sha256 } from "../../infrastructure/ids.js";

let publisher: androidpublisher_v3.Androidpublisher | undefined;

async function androidPublisher(): Promise<androidpublisher_v3.Androidpublisher> {
  if (publisher) return publisher;
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: env().FIREBASE_CLIENT_EMAIL,
      private_key: env().FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    },
    scopes: ["https://www.googleapis.com/auth/androidpublisher"]
  });
  publisher = google.androidpublisher({ version: "v3", auth });
  return publisher;
}

function tokenId(purchaseToken: string): string {
  return `play_${sha256(purchaseToken)}`;
}

async function resolveUid(input: {
  store: EntitlementStore;
  authenticatedUid?: string;
  accountToken?: string | null;
  linkedPurchaseToken?: string | null;
}): Promise<string> {
  const tokenUid = input.accountToken ? await input.store.uidForStoreAccountToken(input.accountToken) : undefined;
  const linkedUid = input.linkedPurchaseToken
    ? await input.store.uidForProviderSubscription("google_play", tokenId(input.linkedPurchaseToken))
    : undefined;
  const resolved = tokenUid ?? linkedUid ?? input.authenticatedUid;
  if (!resolved) throw new Error("Google Play purchase is not linked to a WonderLang account.");
  for (const candidate of [tokenUid, linkedUid, input.authenticatedUid]) {
    if (candidate && candidate !== resolved) throw new Error("Google Play purchase account identifiers disagree.");
  }
  return resolved;
}

function playSubscriptionState(value: string | null | undefined): LedgerGrant["state"] {
  switch (value) {
    case "SUBSCRIPTION_STATE_ACTIVE": return "active";
    case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD": return "grace";
    case "SUBSCRIPTION_STATE_PENDING": return "pending";
    case "SUBSCRIPTION_STATE_CANCELED": {
      // Canceled may remain entitled until the line-item expiry date.
      return "active";
    }
    default: return "expired";
  }
}

function maxExpiry(lineItems: androidpublisher_v3.Schema$SubscriptionPurchaseLineItem[] | null | undefined): string | undefined {
  const values = (lineItems ?? [])
    .map((item) => item.expiryTime)
    .filter((value): value is string => Boolean(value));
  return values.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

export async function syncGooglePlaySubscription(input: {
  store: EntitlementStore;
  purchaseToken: string;
  authenticatedUid?: string;
  eventId: string;
  eventCreated: number;
}): Promise<EffectiveEntitlements> {
  const api = await androidPublisher();
  const response = await api.purchases.subscriptionsv2.get({
    packageName: env().GOOGLE_PLAY_PACKAGE_NAME,
    token: input.purchaseToken
  });
  const purchase = response.data;
  const monthlyLine = purchase.lineItems?.find((item) => item.productId === env().GOOGLE_PLAY_MONTHLY_PRODUCT_ID);
  if (!monthlyLine) throw new HttpError(403, "Google Play receipt is not the WonderLang monthly product.");
  const uid = await resolveUid({
    store: input.store,
    ...(input.authenticatedUid ? { authenticatedUid: input.authenticatedUid } : {}),
    ...(purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId
      ? { accountToken: purchase.externalAccountIdentifiers.obfuscatedExternalAccountId }
      : {}),
    ...(purchase.linkedPurchaseToken ? { linkedPurchaseToken: purchase.linkedPurchaseToken } : {})
  });
  const transactionId = tokenId(input.purchaseToken);
  const periodEnd = maxExpiry(purchase.lineItems);
  let state = playSubscriptionState(purchase.subscriptionState);
  if (state === "active" && purchase.subscriptionState === "SUBSCRIPTION_STATE_CANCELED" && periodEnd && Date.parse(periodEnd) <= Date.now()) {
    state = "expired";
  }
  const start = purchase.startTime ?? new Date(input.eventCreated * 1000).toISOString();
  await input.store.upsertGrant({
    id: "",
    uid,
    provider: "google_play",
    providerTransactionId: transactionId,
    providerSubscriptionId: transactionId,
    product: "mobile_full_monthly",
    state,
    startsAt: start,
    ...(periodEnd ? { currentPeriodEndsAt: periodEnd } : {}),
    ...(periodEnd && state === "active" ? { endsAt: periodEnd } : {}),
    ...(state === "grace" && periodEnd ? { graceEndsAt: periodEnd } : {}),
    ...(state === "expired" ? { endsAt: periodEnd ?? new Date(input.eventCreated * 1000).toISOString() } : {}),
    metadata: {
      playSubscriptionState: purchase.subscriptionState ?? "UNKNOWN",
      autoRenewEnabled: monthlyLine.autoRenewingPlan?.autoRenewEnabled ?? false,
      latestOrderId: purchase.lineItems?.[0]?.latestSuccessfulOrderId ?? purchase.latestOrderId ?? ""
    }
  }, { id: input.eventId, created: input.eventCreated });
  if (purchase.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING") {
    await api.purchases.subscriptions.acknowledge({
      packageName: env().GOOGLE_PLAY_PACKAGE_NAME,
      subscriptionId: env().GOOGLE_PLAY_MONTHLY_PRODUCT_ID,
      token: input.purchaseToken,
      requestBody: {}
    });
  }
  if (purchase.linkedPurchaseToken) {
    const linkedTransaction = tokenId(purchase.linkedPurchaseToken);
    await input.store.revokeByProviderTransaction({
      provider: "google_play",
      providerTransactionId: linkedTransaction,
      state: "revoked",
      sourceEvent: { id: input.eventId, created: input.eventCreated },
      at: new Date(input.eventCreated * 1000)
    });
  }
  return input.store.effectiveEntitlements(uid, new Date());
}

export async function syncGooglePlayOneTimeProduct(input: {
  store: EntitlementStore;
  productId: string;
  purchaseToken: string;
  authenticatedUid?: string;
  eventId: string;
  eventCreated: number;
}): Promise<EffectiveEntitlements> {
  const product = LEGACY_PLAY_PRODUCT_MAP[input.productId];
  if (!product) throw new HttpError(403, "Unknown Google Play product ID.");
  const api = await androidPublisher();
  const response = await api.purchases.productsv2.getproductpurchasev2({
    packageName: env().GOOGLE_PLAY_PACKAGE_NAME,
    token: input.purchaseToken
  });
  const purchase = response.data;
  if (!purchase.productLineItem?.some((item) => item.productId === input.productId)) {
    throw new HttpError(403, "Google Play receipt product does not match the requested product.");
  }
  const uid = await resolveUid({
    store: input.store,
    ...(input.authenticatedUid ? { authenticatedUid: input.authenticatedUid } : {}),
    ...(purchase.obfuscatedExternalAccountId ? { accountToken: purchase.obfuscatedExternalAccountId } : {})
  });
  const purchaseState = purchase.purchaseStateContext?.purchaseState;
  const state: LedgerGrant["state"] = purchaseState === "PURCHASED"
    ? "active"
    : purchaseState === "PENDING" ? "pending" : "revoked";
  const transactionId = purchase.orderId || tokenId(input.purchaseToken);
  await input.store.upsertGrant({
    id: "",
    uid,
    provider: "google_play",
    providerTransactionId: transactionId,
    product,
    state,
    startsAt: purchase.purchaseCompletionTime ?? new Date(input.eventCreated * 1000).toISOString(),
    ...(state === "revoked" ? { endsAt: new Date(input.eventCreated * 1000).toISOString() } : {}),
    metadata: { productId: input.productId, purchaseTokenHash: tokenId(input.purchaseToken) }
  }, { id: input.eventId, created: input.eventCreated });
  if (state === "active" && purchase.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING") {
    await api.purchases.products.acknowledge({
      packageName: env().GOOGLE_PLAY_PACKAGE_NAME,
      productId: input.productId,
      token: input.purchaseToken,
      requestBody: {}
    });
  }
  return input.store.effectiveEntitlements(uid, new Date());
}
