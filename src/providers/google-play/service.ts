import { google, type androidpublisher_v3 } from "googleapis";
import { googlePlayEnv } from "../../config/env.js";
import { LEGACY_PLAY_PRODUCT_MAP } from "../../domain/catalog.js";
import type { EffectiveEntitlements, LedgerGrant } from "../../domain/model.js";
import { HttpError } from "../../http/auth.js";
import type { EntitlementStore } from "../../infrastructure/entitlement-store.js";
import { sha256 } from "../../infrastructure/ids.js";
import { assertProviderTokenEncryptionConfigured } from "../../infrastructure/provider-token-crypto.js";
import { normalizeGoogleServiceAccountPrivateKey } from "../../infrastructure/private-key.js";
import { chapterMigrationGrant } from "../../domain/legacy-chapter-migration.js";

let publisher: androidpublisher_v3.Androidpublisher | undefined;

type GooglePlayOutOfAppPurchaseContext = {
  expiredExternalAccountIdentifiers?: {
    obfuscatedExternalAccountId?: string | null;
  } | null;
  expiredPurchaseToken?: string | null;
};

type SubscriptionPurchaseWithOutOfAppContext = androidpublisher_v3.Schema$SubscriptionPurchaseV2 & {
  outOfAppPurchaseContext?: GooglePlayOutOfAppPurchaseContext | null;
};

type SubscriptionLineItemWithOfferPhase = androidpublisher_v3.Schema$SubscriptionPurchaseLineItem & {
  offerPhase?: {
    freeTrial?: unknown;
  } | null;
};

type SubscriptionAcknowledgeRequestWithAccount = androidpublisher_v3.Schema$SubscriptionPurchasesAcknowledgeRequest & {
  externalAccountIds?: {
    obfuscatedAccountId?: string;
  };
};

async function androidPublisher(): Promise<androidpublisher_v3.Androidpublisher> {
  if (publisher) return publisher;
  const configuration = googlePlayEnv();
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: configuration.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL,
      private_key: normalizeGoogleServiceAccountPrivateKey(configuration.GOOGLE_PLAY_PRIVATE_KEY)
    },
    scopes: ["https://www.googleapis.com/auth/androidpublisher"]
  });
  publisher = google.androidpublisher({ version: "v3", auth });
  return publisher;
}

function tokenId(purchaseToken: string): string {
  return `play_${sha256(purchaseToken)}`;
}

export function googlePlayOutOfAppPurchaseContext(
  purchase: androidpublisher_v3.Schema$SubscriptionPurchaseV2
): { expiredAccountToken?: string; expiredPurchaseToken?: string } | undefined {
  const context = (purchase as SubscriptionPurchaseWithOutOfAppContext).outOfAppPurchaseContext;
  if (!context) return undefined;
  const expiredAccountToken = context.expiredExternalAccountIdentifiers?.obfuscatedExternalAccountId?.trim();
  const expiredPurchaseToken = context.expiredPurchaseToken?.trim();
  return {
    ...(expiredAccountToken ? { expiredAccountToken } : {}),
    ...(expiredPurchaseToken ? { expiredPurchaseToken } : {})
  };
}

export function googlePlaySubscriptionAcknowledgeRequest(
  accountToken?: string
): SubscriptionAcknowledgeRequestWithAccount {
  return accountToken
    ? { externalAccountIds: { obfuscatedAccountId: accountToken } }
    : {};
}

export function googlePlayLineItemIsFreeTrial(
  lineItem: androidpublisher_v3.Schema$SubscriptionPurchaseLineItem
): boolean {
  const offerPhase = (lineItem as SubscriptionLineItemWithOfferPhase).offerPhase;
  return Boolean(offerPhase && Object.prototype.hasOwnProperty.call(offerPhase, "freeTrial"));
}

export async function resolveGooglePlayPurchaseIdentity(input: {
  store: EntitlementStore;
  authenticatedUid?: string;
  accountToken?: string | null;
  currentProviderTransactionId?: string | null;
  linkedPurchaseToken?: string | null;
  expiredAccountToken?: string | null;
  expiredPurchaseToken?: string | null;
}): Promise<{ uid: string; attributionVerified: boolean }> {
  const [
    tokenUid,
    currentTransactionUid,
    currentTransactionAttributionUid,
    linkedUid,
    expiredTokenUid,
    expiredPurchaseUid
  ] = await Promise.all([
    input.accountToken ? input.store.uidForStoreAccountToken(input.accountToken) : Promise.resolve(undefined),
    input.currentProviderTransactionId
      ? input.store.uidForProviderTransaction("google_play", input.currentProviderTransactionId)
      : Promise.resolve(undefined),
    input.currentProviderTransactionId
      ? input.store.uidForProviderTransactionForAttribution("google_play", input.currentProviderTransactionId)
      : Promise.resolve(undefined),
    input.linkedPurchaseToken
      ? input.store.uidForProviderSubscriptionForAttribution("google_play", tokenId(input.linkedPurchaseToken))
      : Promise.resolve(undefined),
    input.expiredAccountToken
      ? input.store.uidForStoreAccountToken(input.expiredAccountToken)
      : Promise.resolve(undefined),
    input.expiredPurchaseToken
      ? input.store.uidForProviderSubscriptionForAttribution("google_play", tokenId(input.expiredPurchaseToken))
      : Promise.resolve(undefined)
  ]);
  const resolved = tokenUid ?? currentTransactionUid ?? linkedUid ?? expiredTokenUid ?? expiredPurchaseUid ?? input.authenticatedUid;
  if (!resolved) throw new Error("Google Play purchase is not linked to a WonderLang account.");
  for (const candidate of [
    tokenUid,
    currentTransactionUid,
    currentTransactionAttributionUid,
    linkedUid,
    expiredTokenUid,
    expiredPurchaseUid,
    input.authenticatedUid
  ]) {
    if (candidate && candidate !== resolved) throw new Error("Google Play purchase account identifiers disagree.");
  }
  return {
    uid: resolved,
    attributionVerified: [
      tokenUid,
      currentTransactionAttributionUid,
      linkedUid,
      expiredTokenUid,
      expiredPurchaseUid,
      input.authenticatedUid
    ].some((candidate) => candidate === resolved)
  };
}

export function normalizeGooglePlaySubscriptionState(value: string | null | undefined): LedgerGrant["state"] {
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

export function googlePlaySubscriptionGrantState(
  providerState: string | null | undefined,
  periodEnd: string | undefined,
  now = new Date()
): LedgerGrant["state"] {
  const state = normalizeGooglePlaySubscriptionState(providerState);
  if (state === "pending" || state === "expired") return state;
  const periodEndMs = periodEnd ? Date.parse(periodEnd) : Number.NaN;
  return Number.isFinite(periodEndMs) && now.getTime() < periodEndMs ? state : "expired";
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
  acknowledge?: boolean;
}): Promise<EffectiveEntitlements> {
  assertProviderTokenEncryptionConfigured();
  const api = await androidPublisher();
  const configuration = googlePlayEnv();
  const response = await api.purchases.subscriptionsv2.get({
    packageName: configuration.GOOGLE_PLAY_PACKAGE_NAME,
    token: input.purchaseToken
  });
  const purchase = response.data;
  const monthlyLine = purchase.lineItems?.find((item) => item.productId === configuration.GOOGLE_PLAY_MONTHLY_PRODUCT_ID);
  if (!monthlyLine) throw new HttpError(403, "Google Play receipt is not the WonderLang monthly product.");
  const transactionId = tokenId(input.purchaseToken);
  const outOfApp = googlePlayOutOfAppPurchaseContext(purchase);
  const identity = await resolveGooglePlayPurchaseIdentity({
    store: input.store,
    ...(input.authenticatedUid ? { authenticatedUid: input.authenticatedUid } : {}),
    currentProviderTransactionId: transactionId,
    ...(purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId
      ? { accountToken: purchase.externalAccountIdentifiers.obfuscatedExternalAccountId }
      : {}),
    ...(purchase.linkedPurchaseToken ? { linkedPurchaseToken: purchase.linkedPurchaseToken } : {}),
    ...(outOfApp?.expiredAccountToken ? { expiredAccountToken: outOfApp.expiredAccountToken } : {}),
    ...(outOfApp?.expiredPurchaseToken ? { expiredPurchaseToken: outOfApp.expiredPurchaseToken } : {})
  });
  const uid = identity.uid;
  const periodEnd = maxExpiry(purchase.lineItems);
  const trialEndsAt = googlePlayLineItemIsFreeTrial(monthlyLine)
    ? monthlyLine.expiryTime ?? periodEnd
    : undefined;
  const state = googlePlaySubscriptionGrantState(purchase.subscriptionState, periodEnd);
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
      latestOrderId: purchase.lineItems?.[0]?.latestSuccessfulOrderId ?? purchase.latestOrderId ?? "",
      outOfAppResubscription: Boolean(outOfApp),
      attributionVerified: identity.attributionVerified,
      ...(trialEndsAt ? { trialEndsAt } : {})
    }
  }, { id: input.eventId, created: input.eventCreated });
  await input.store.saveGooglePlaySubscriptionToken({
    uid,
    providerSubscriptionId: transactionId,
    purchaseToken: input.purchaseToken,
    now: new Date(input.eventCreated * 1000)
  });
  if (input.acknowledge !== false && purchase.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING") {
    // After final account deletion, retained pseudonymous links may continue
    // receiving lifecycle events but must not bind or acknowledge a new Play
    // purchase. An unacknowledged purchase will be refunded by Google.
    if (identity.attributionVerified) {
      const accountToken = outOfApp
        ? await input.store.storeAccountToken(uid, new Date(input.eventCreated * 1000))
        : undefined;
      await api.purchases.subscriptions.acknowledge({
        packageName: configuration.GOOGLE_PLAY_PACKAGE_NAME,
        subscriptionId: configuration.GOOGLE_PLAY_MONTHLY_PRODUCT_ID,
        token: input.purchaseToken,
        requestBody: googlePlaySubscriptionAcknowledgeRequest(accountToken)
      });
    }
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
    await input.store.deleteGooglePlaySubscriptionToken(linkedTransaction);
  }
  return input.store.effectiveEntitlements(uid, new Date());
}

export async function reconcileGooglePlaySubscription(input: {
  store: EntitlementStore;
  uid: string;
  providerSubscriptionId: string;
  eventId: string;
  eventCreated: number;
}): Promise<EffectiveEntitlements> {
  const purchaseToken = await input.store.googlePlaySubscriptionToken({
    uid: input.uid,
    providerSubscriptionId: input.providerSubscriptionId
  });
  if (tokenId(purchaseToken) !== input.providerSubscriptionId) {
    throw new Error("Encrypted Google Play subscription token does not match its ledger identifier.");
  }
  return syncGooglePlaySubscription({
    store: input.store,
    purchaseToken,
    authenticatedUid: input.uid,
    eventId: input.eventId,
    eventCreated: input.eventCreated,
    // Reconciliation reads provider state; only the authenticated purchase or
    // webhook flow is allowed to acknowledge a purchase at Google Play.
    acknowledge: false
  });
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
  const configuration = googlePlayEnv();
  const response = await api.purchases.productsv2.getproductpurchasev2({
    packageName: configuration.GOOGLE_PLAY_PACKAGE_NAME,
    token: input.purchaseToken
  });
  const purchase = response.data;
  if (!purchase.productLineItem?.some((item) => item.productId === input.productId)) {
    throw new HttpError(403, "Google Play receipt product does not match the requested product.");
  }
  const transactionId = purchase.orderId || tokenId(input.purchaseToken);
  const identity = await resolveGooglePlayPurchaseIdentity({
    store: input.store,
    ...(input.authenticatedUid ? { authenticatedUid: input.authenticatedUid } : {}),
    currentProviderTransactionId: transactionId,
    ...(purchase.obfuscatedExternalAccountId ? { accountToken: purchase.obfuscatedExternalAccountId } : {})
  });
  const uid = identity.uid;
  const purchaseState = purchase.purchaseStateContext?.purchaseState;
  const state: LedgerGrant["state"] = purchaseState === "PURCHASED"
    ? "active"
    : purchaseState === "PENDING" ? "pending" : "revoked";
  const originalGrant: LedgerGrant = {
    id: "",
    uid,
    provider: "google_play",
    providerTransactionId: transactionId,
    product,
    state,
    startsAt: purchase.purchaseCompletionTime ?? new Date(input.eventCreated * 1000).toISOString(),
    ...(state === "revoked" ? { endsAt: new Date(input.eventCreated * 1000).toISOString() } : {}),
    metadata: {
      productId: input.productId,
      purchaseTokenHash: tokenId(input.purchaseToken),
      attributionVerified: identity.attributionVerified
    }
  };
  await input.store.upsertGrant(originalGrant, { id: input.eventId, created: input.eventCreated });
  const migration = state !== "pending" ? chapterMigrationGrant(originalGrant) : undefined;
  if (migration) await input.store.upsertGrant(migration, { id: `${input.eventId}:chapter-full-upgrade`, created: input.eventCreated });
  if (
    state === "active" &&
    identity.attributionVerified &&
    purchase.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING"
  ) {
    await api.purchases.products.acknowledge({
      packageName: configuration.GOOGLE_PLAY_PACKAGE_NAME,
      productId: input.productId,
      token: input.purchaseToken,
      requestBody: {}
    });
  }
  return input.store.effectiveEntitlements(uid, new Date());
}
