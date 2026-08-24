import {
  Environment,
  SignedDataVerifier,
  Status,
  type JWSTransactionDecodedPayload,
  type JWSRenewalInfoDecodedPayload,
  type ResponseBodyV2DecodedPayload
} from "@apple/app-store-server-library";
import { env } from "../../config/env.js";
import { LEGACY_PLAY_PRODUCT_MAP } from "../../domain/catalog.js";
import type { EffectiveEntitlements, LedgerGrant } from "../../domain/model.js";
import { HttpError } from "../../http/auth.js";
import type { EntitlementStore } from "../../infrastructure/entitlement-store.js";
import { chapterMigrationGrant } from "../../domain/legacy-chapter-migration.js";

let verifier: SignedDataVerifier | undefined;

function appleVerifier(): SignedDataVerifier {
  if (verifier) return verifier;
  const bundleId = env().APPLE_BUNDLE_ID;
  const g2 = env().APPLE_ROOT_CA_G2_BASE64;
  const g3 = env().APPLE_ROOT_CA_G3_BASE64;
  if (!bundleId || !g2 || !g3) throw new Error("Apple bundle ID and root CA certificates are not configured.");
  const environment = env().APPLE_ENVIRONMENT === "Production" ? Environment.PRODUCTION : Environment.SANDBOX;
  const appAppleId = environment === Environment.PRODUCTION && env().APPLE_APP_ID
    ? Number(env().APPLE_APP_ID)
    : undefined;
  if (environment === Environment.PRODUCTION && !appAppleId) throw new Error("APPLE_APP_ID is required in Production.");
  verifier = new SignedDataVerifier(
    [Buffer.from(g2, "base64"), Buffer.from(g3, "base64")],
    true,
    environment,
    bundleId,
    appAppleId
  );
  return verifier;
}

async function resolveUid(input: {
  store: EntitlementStore;
  transaction: JWSTransactionDecodedPayload;
  renewal?: JWSRenewalInfoDecodedPayload;
  authenticatedUid?: string;
}): Promise<string> {
  const accountToken = input.transaction.appAccountToken ?? input.renewal?.appAccountToken;
  const tokenUid = accountToken ? await input.store.uidForStoreAccountToken(accountToken) : undefined;
  const originalId = input.transaction.originalTransactionId;
  const linkedUid = originalId ? await input.store.uidForProviderSubscription("apple", originalId) : undefined;
  const uid = tokenUid ?? linkedUid ?? input.authenticatedUid;
  if (!uid) throw new Error("Apple transaction is not linked to a WonderLang account.");
  for (const candidate of [tokenUid, linkedUid, input.authenticatedUid]) {
    if (candidate && candidate !== uid) throw new Error("Apple transaction account identifiers disagree.");
  }
  return uid;
}

function subscriptionState(input: {
  status?: Status | number;
  transaction: JWSTransactionDecodedPayload;
  renewal?: JWSRenewalInfoDecodedPayload;
  now: Date;
}): { state: LedgerGrant["state"]; graceEndsAt?: string } {
  if (input.transaction.revocationDate) return { state: "revoked" };
  const graceMs = input.renewal?.gracePeriodExpiresDate;
  if (input.status === Status.BILLING_GRACE_PERIOD && graceMs && graceMs > input.now.getTime()) {
    return { state: "grace", graceEndsAt: new Date(graceMs).toISOString() };
  }
  if (input.status === Status.REVOKED) return { state: "revoked" };
  if (input.status === Status.EXPIRED || input.status === Status.BILLING_RETRY) return { state: "expired" };
  if (input.transaction.expiresDate && input.transaction.expiresDate <= input.now.getTime()) return { state: "expired" };
  return { state: "active" };
}

async function applyAppleTransaction(input: {
  store: EntitlementStore;
  transaction: JWSTransactionDecodedPayload;
  renewal?: JWSRenewalInfoDecodedPayload;
  status?: Status | number;
  authenticatedUid?: string;
  eventId: string;
  eventCreated: number;
}): Promise<EffectiveEntitlements> {
  const productId = input.transaction.productId;
  const transactionId = input.transaction.transactionId;
  const originalId = input.transaction.originalTransactionId;
  if (!productId || !transactionId) throw new Error("Verified Apple transaction is missing product or transaction ID.");
  const uid = await resolveUid(input);
  const now = new Date(input.eventCreated * 1000);
  let product: LedgerGrant["product"];
  if (productId === env().APPLE_MONTHLY_PRODUCT_ID) product = "mobile_full_monthly";
  else if (productId === env().APPLE_POLYGLOT_PRODUCT_ID) product = "mobile_polyglot_permanent";
  else product = LEGACY_PLAY_PRODUCT_MAP[productId] ?? (() => { throw new HttpError(403, "Unknown Apple product ID."); })();

  if (product === "mobile_full_monthly") {
    if (!originalId) throw new Error("Apple subscription is missing originalTransactionId.");
    const normalized = subscriptionState({
      ...(input.status !== undefined ? { status: input.status } : {}),
      transaction: input.transaction,
      ...(input.renewal ? { renewal: input.renewal } : {}),
      now
    });
    await input.store.upsertGrant({
      id: "",
      uid,
      provider: "apple",
      providerTransactionId: originalId,
      providerSubscriptionId: originalId,
      product,
      state: normalized.state,
      startsAt: new Date(input.transaction.originalPurchaseDate ?? input.transaction.purchaseDate ?? now.getTime()).toISOString(),
      ...(input.transaction.expiresDate ? { currentPeriodEndsAt: new Date(input.transaction.expiresDate).toISOString() } : {}),
      ...(normalized.state === "active" && input.transaction.expiresDate ? {
        endsAt: new Date(input.transaction.expiresDate).toISOString()
      } : {}),
      ...(normalized.graceEndsAt ? { graceEndsAt: normalized.graceEndsAt } : {}),
      ...(normalized.state === "expired" || normalized.state === "revoked" ? {
        endsAt: new Date(input.transaction.revocationDate ?? input.transaction.expiresDate ?? now.getTime()).toISOString()
      } : {}),
      metadata: {
        latestTransactionId: transactionId,
        notificationStatus: input.status ?? 0,
        autoRenewStatus: input.renewal?.autoRenewStatus ?? 0
      }
    }, { id: input.eventId, created: input.eventCreated });
  } else {
    const revoked = Boolean(input.transaction.revocationDate);
    const originalGrant: LedgerGrant = {
      id: "",
      uid,
      provider: "apple",
      providerTransactionId: transactionId,
      product,
      state: revoked ? "refunded" : "active",
      startsAt: new Date(input.transaction.purchaseDate ?? now.getTime()).toISOString(),
      ...(revoked ? {
        endsAt: new Date(input.transaction.revocationDate as number).toISOString(),
        refundedAt: new Date(input.transaction.revocationDate as number).toISOString()
      } : {}),
      metadata: { originalTransactionId: originalId ?? transactionId }
    };
    await input.store.upsertGrant(originalGrant, { id: input.eventId, created: input.eventCreated });
    const migration = chapterMigrationGrant(originalGrant);
    if (migration) await input.store.upsertGrant(migration, { id: `${input.eventId}:chapter-full-upgrade`, created: input.eventCreated });
  }
  return input.store.effectiveEntitlements(uid, new Date());
}

export async function verifyAppleNotification(signedPayload: string): Promise<{
  notification: ResponseBodyV2DecodedPayload;
  transaction?: JWSTransactionDecodedPayload;
  renewal?: JWSRenewalInfoDecodedPayload;
}> {
  const notification = await appleVerifier().verifyAndDecodeNotification(signedPayload);
  const transaction = notification.data?.signedTransactionInfo
    ? await appleVerifier().verifyAndDecodeTransaction(notification.data.signedTransactionInfo)
    : undefined;
  const renewal = notification.data?.signedRenewalInfo
    ? await appleVerifier().verifyAndDecodeRenewalInfo(notification.data.signedRenewalInfo)
    : undefined;
  return {
    notification,
    ...(transaction ? { transaction } : {}),
    ...(renewal ? { renewal } : {})
  };
}

export async function processAppleNotification(input: {
  store: EntitlementStore;
  verified: Awaited<ReturnType<typeof verifyAppleNotification>>;
}): Promise<void> {
  const { notification, transaction, renewal } = input.verified;
  if (!transaction) return;
  await applyAppleTransaction({
    store: input.store,
    transaction,
    ...(renewal ? { renewal } : {}),
    ...(notification.data?.status !== undefined ? { status: notification.data.status } : {}),
    eventId: notification.notificationUUID ?? `apple-${transaction.transactionId}`,
    eventCreated: Math.floor((notification.signedDate ?? Date.now()) / 1000)
  });
}

export async function claimAppleTransaction(input: {
  store: EntitlementStore;
  authenticatedUid: string;
  signedTransactionInfo: string;
  now: Date;
}): Promise<EffectiveEntitlements> {
  const transaction = await appleVerifier().verifyAndDecodeTransaction(input.signedTransactionInfo);
  return applyAppleTransaction({
    store: input.store,
    transaction,
    authenticatedUid: input.authenticatedUid,
    eventId: `app-claim:${transaction.transactionId}`,
    eventCreated: Math.floor(input.now.getTime() / 1000)
  });
}
