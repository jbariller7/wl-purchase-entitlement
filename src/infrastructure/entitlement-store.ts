import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { projectEntitlements } from "../domain/entitlement-projector.js";
import type {
  EffectiveEntitlements,
  LedgerGrant,
  LegacyOrder,
  OutboxJob,
  OutboxKind,
  Provider
} from "../domain/model.js";
import type { LegacyDiscountClaim } from "../domain/legacy-discount.js";
import { stableDocumentId } from "./ids.js";
import { providerEventDecision } from "../domain/provider-event.js";
import { safeErrorMessage } from "./safe-error.js";
import {
  decryptProviderToken,
  encryptProviderToken,
  type EncryptedProviderToken
} from "./provider-token-crypto.js";

const SUBSCRIPTION_RECONCILIATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const EXPIRED_SUBSCRIPTION_RECOVERY_MS = 90 * 24 * 60 * 60 * 1000;

interface StoredGrant extends LedgerGrant {
  sourceEventCreated: number;
  sourceEventId: string;
}

export class EntitlementStore {
  constructor(private readonly db: Firestore) {}

  firestore(): Firestore { return this.db; }

  async beginProviderEvent(input: {
    provider: Provider;
    providerEventId: string;
    eventType: string;
    eventCreated: number;
    payloadSha256: string;
    now: Date;
  }): Promise<"process" | "duplicate"> {
    const ref = this.db.collection("providerEvents").doc(
      stableDocumentId(input.provider, input.providerEventId)
    );
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (snapshot.exists) {
        const existing = snapshot.data() as { status?: string; attemptCount?: number; lastAttemptAt?: string };
        if (providerEventDecision(existing, input.now) === "duplicate") return "duplicate";
        transaction.update(ref, {
          status: "processing",
          attemptCount: (existing.attemptCount ?? 0) + 1,
          lastAttemptAt: input.now.toISOString(),
          lastError: null
        });
        return "process";
      }
      transaction.create(ref, {
        provider: input.provider,
        providerEventId: input.providerEventId,
        eventType: input.eventType,
        eventCreated: input.eventCreated,
        receivedAt: input.now.toISOString(),
        lastAttemptAt: input.now.toISOString(),
        status: "processing",
        attemptCount: 1,
        // The digest proves replay identity without retaining provider-controlled
        // payloads that can contain email, billing, device, or receipt data.
        payloadSha256: input.payloadSha256
      });
      return "process";
    });
  }

  async completeProviderEvent(provider: Provider, providerEventId: string, now: Date): Promise<void> {
    await this.db.collection("providerEvents").doc(stableDocumentId(provider, providerEventId)).update({
      status: "processed",
      processedAt: now.toISOString(),
      lastError: null
    });
  }

  async failProviderEvent(provider: Provider, providerEventId: string, error: unknown, now: Date): Promise<void> {
    await this.db.collection("providerEvents").doc(stableDocumentId(provider, providerEventId)).update({
      status: "failed",
      failedAt: now.toISOString(),
      lastError: safeErrorMessage(error, "Unknown processor error")
    });
  }

  grantId(grant: Pick<LedgerGrant, "provider" | "providerTransactionId" | "product">): string {
    return stableDocumentId("grant", `${grant.provider}:${grant.providerTransactionId}:${grant.product}`);
  }

  async upsertGrant(grant: LedgerGrant, sourceEvent: { id: string; created: number }): Promise<boolean> {
    const ref = this.db.collection("grants").doc(this.grantId(grant));
    const linkRef = this.db.collection("providerTransactions").doc(
      stableDocumentId(grant.provider, grant.providerTransactionId)
    );
    const subscriptionRef = grant.providerSubscriptionId
      ? this.db.collection("providerSubscriptions").doc(stableDocumentId(grant.provider, grant.providerSubscriptionId))
      : undefined;
    const writtenAt = new Date();
    const updated = await this.db.runTransaction(async (transaction) => {
      const [current, transactionLink, subscriptionLink] = await Promise.all([
        transaction.get(ref),
        transaction.get(linkRef),
        subscriptionRef ? transaction.get(subscriptionRef) : Promise.resolve(undefined)
      ]);
      const linkedUid = transactionLink?.data()?.uid as string | undefined;
      if (linkedUid && linkedUid !== grant.uid) throw new Error("Provider transaction is already linked to another account.");
      const subscriptionUid = subscriptionLink?.data()?.uid as string | undefined;
      if (subscriptionUid && subscriptionUid !== grant.uid) throw new Error("Provider subscription is already linked to another account.");
      const data = current.data() as StoredGrant | undefined;
      if (data && data.sourceEventCreated > sourceEvent.created) return false;
      transaction.set(ref, {
        ...grant,
        id: ref.id,
        sourceEventId: sourceEvent.id,
        sourceEventCreated: sourceEvent.created,
        updatedAt: writtenAt.toISOString()
      });
      transaction.set(linkRef, {
        provider: grant.provider,
        providerTransactionId: grant.providerTransactionId,
        uid: grant.uid,
        grantId: ref.id,
        updatedAt: writtenAt.toISOString()
      }, { merge: true });
      if (grant.providerSubscriptionId && subscriptionRef) {
        const existingReconcileUntil = subscriptionLink?.data()?.reconcileUntil as string | undefined;
        const reconciliationDisabled = Boolean(subscriptionLink?.data()?.reconciliationDisabledReason);
        const sourceTime = new Date(sourceEvent.created * 1000);
        const defaultReconcileUntil = new Date(sourceTime.getTime() + EXPIRED_SUBSCRIPTION_RECOVERY_MS).toISOString();
        const reconcileUntil = !reconciliationDisabled && grant.product === "mobile_full_monthly" && grant.state === "expired"
          ? existingReconcileUntil ?? defaultReconcileUntil
          : null;
        const reconciliationActive = !reconciliationDisabled && grant.product === "mobile_full_monthly" && (
          grant.state === "active" || grant.state === "grace" || grant.state === "pending" ||
          (grant.state === "expired" && Boolean(reconcileUntil) && Date.parse(String(reconcileUntil)) > writtenAt.getTime())
        );
        transaction.set(subscriptionRef, {
          provider: grant.provider,
          providerSubscriptionId: grant.providerSubscriptionId,
          uid: grant.uid,
          grantId: ref.id,
          product: grant.product,
          state: grant.state,
          nextReconciliationAt: reconciliationActive
            ? new Date(writtenAt.getTime() + SUBSCRIPTION_RECONCILIATION_INTERVAL_MS).toISOString()
            : null,
          reconcileUntil,
          updatedAt: writtenAt.toISOString()
        }, { merge: true });
      }
      return true;
    });
    if (updated) await this.recomputeEntitlements(grant.uid, new Date());
    return updated;
  }

  async getGrant(provider: Provider, providerTransactionId: string, product: LedgerGrant["product"]): Promise<StoredGrant | undefined> {
    const snapshot = await this.db.collection("grants").doc(
      this.grantId({ provider, providerTransactionId, product })
    ).get();
    return snapshot.exists ? snapshot.data() as StoredGrant : undefined;
  }

  async revokeByProviderTransaction(input: {
    provider: Provider;
    providerTransactionId: string;
    state: "revoked" | "refunded";
    sourceEvent: { id: string; created: number };
    at: Date;
  }): Promise<boolean> {
    const link = await this.db.collection("providerTransactions").doc(
      stableDocumentId(input.provider, input.providerTransactionId)
    ).get();
    if (!link.exists) return false;
    const { grantId, uid } = link.data() as { grantId: string; uid: string };
    const grantRef = this.db.collection("grants").doc(grantId);
    const changed = await this.db.runTransaction(async (transaction) => {
      const current = await transaction.get(grantRef);
      if (!current.exists) return false;
      const data = current.data() as StoredGrant;
      if (data.sourceEventCreated > input.sourceEvent.created) return false;
      transaction.update(grantRef, {
        state: input.state,
        endsAt: input.at.toISOString(),
        ...(input.state === "refunded" ? { refundedAt: input.at.toISOString() } : {}),
        sourceEventId: input.sourceEvent.id,
        sourceEventCreated: input.sourceEvent.created,
        updatedAt: input.at.toISOString()
      });
      return true;
    });
    if (changed) await this.recomputeEntitlements(uid, input.at);
    return changed;
  }

  async grantsForUid(uid: string): Promise<LedgerGrant[]> {
    const snapshot = await this.db.collection("grants").where("uid", "==", uid).get();
    return snapshot.docs.map((doc) => doc.data() as LedgerGrant);
  }

  async recomputeEntitlements(uid: string, now: Date): Promise<EffectiveEntitlements> {
    const ref = this.db.collection("entitlements").doc(uid);
    return this.db.runTransaction(async (transaction) => {
      const [previous, grantSnapshot] = await Promise.all([
        transaction.get(ref),
        transaction.get(this.db.collection("grants").where("uid", "==", uid))
      ]);
      const grants = grantSnapshot.docs.map((doc) => doc.data() as LedgerGrant);
      const revision = ((previous.data()?.revision as number | undefined) ?? 0) + 1;
      const effective = projectEntitlements(uid, grants, now, revision);
      transaction.set(ref, effective);
      return effective;
    });
  }

  async effectiveEntitlements(uid: string, now: Date): Promise<EffectiveEntitlements> {
    const [grants, stored] = await Promise.all([
      this.grantsForUid(uid),
      this.db.collection("entitlements").doc(uid).get()
    ]);
    return projectEntitlements(uid, grants, now, (stored.data()?.revision as number | undefined) ?? 0);
  }

  async stripeCustomerId(uid: string): Promise<string | undefined> {
    const user = await this.db.collection("users").doc(uid).get();
    return user.data()?.stripeCustomerId as string | undefined;
  }

  async linkStripeCustomer(uid: string, customerId: string, email: string | undefined, now: Date): Promise<void> {
    const userRef = this.db.collection("users").doc(uid);
    const linkRef = this.db.collection("providerCustomers").doc(stableDocumentId("stripe", customerId));
    await this.db.runTransaction(async (transaction) => {
      const [user, link] = await Promise.all([transaction.get(userRef), transaction.get(linkRef)]);
      const linkedUid = link.data()?.uid as string | undefined;
      if (linkedUid && linkedUid !== uid) throw new Error("Stripe customer is already linked to another account.");
      const existingCustomer = user.data()?.stripeCustomerId as string | undefined;
      if (existingCustomer && existingCustomer !== customerId) {
        throw new Error("This account is already linked to a different Stripe customer.");
      }
      transaction.set(userRef, {
        uid,
        stripeCustomerId: customerId,
        ...(email ? { email: email.toLowerCase() } : {}),
        updatedAt: now.toISOString()
      }, { merge: true });
      transaction.set(linkRef, { provider: "stripe", customerId, uid, updatedAt: now.toISOString() });
    });
  }

  async uidForStripeCustomer(customerId: string): Promise<string | undefined> {
    const link = await this.db.collection("providerCustomers").doc(stableDocumentId("stripe", customerId)).get();
    return link.data()?.uid as string | undefined;
  }

  async uidForProviderTransaction(provider: Provider, transactionId: string): Promise<string | undefined> {
    const link = await this.db.collection("providerTransactions").doc(
      stableDocumentId(provider, transactionId)
    ).get();
    return link.data()?.uid as string | undefined;
  }

  async uidForCheckoutSession(sessionId: string): Promise<string | undefined> {
    const context = await this.db.collection("checkoutContexts").doc(sessionId).get();
    return context.data()?.uid as string | undefined;
  }

  async uidForProviderSubscription(provider: Provider, subscriptionId: string): Promise<string | undefined> {
    const link = await this.db.collection("providerSubscriptions").doc(
      stableDocumentId(provider, subscriptionId)
    ).get();
    return link.data()?.uid as string | undefined;
  }

  private providerSecretRef(provider: Provider, subscriptionId: string) {
    return this.db.collection("providerSecrets").doc(stableDocumentId(provider, subscriptionId));
  }

  private providerTokenAssociatedData(provider: Provider, subscriptionId: string, uid: string): string {
    return `wonderlang:${provider}:${subscriptionId}:${uid}`;
  }

  async saveGooglePlaySubscriptionToken(input: {
    uid: string;
    providerSubscriptionId: string;
    purchaseToken: string;
    now: Date;
  }): Promise<void> {
    const subscriptionRef = this.db.collection("providerSubscriptions").doc(
      stableDocumentId("google_play", input.providerSubscriptionId)
    );
    const secretRef = this.providerSecretRef("google_play", input.providerSubscriptionId);
    const encrypted = encryptProviderToken(
      input.purchaseToken,
      this.providerTokenAssociatedData("google_play", input.providerSubscriptionId, input.uid)
    );
    await this.db.runTransaction(async (transaction) => {
      const [subscription, secret] = await Promise.all([
        transaction.get(subscriptionRef),
        transaction.get(secretRef)
      ]);
      if (!subscription.exists || subscription.data()?.uid !== input.uid) {
        throw new Error("Google Play subscription link is unavailable or belongs to another account.");
      }
      // A provider notification may race with final account deletion. The
      // retained pseudonymous link can still accept lifecycle audit updates,
      // but erased bearer-token ciphertext must never be recreated.
      if (subscription.data()?.reconciliationDisabledReason === "account_deleted") return;
      transaction.set(secretRef, {
        provider: "google_play",
        providerSubscriptionId: input.providerSubscriptionId,
        uid: input.uid,
        kind: "subscription_purchase_token",
        encrypted,
        updatedAt: input.now.toISOString(),
        ...(secret.exists ? {} : { createdAt: input.now.toISOString() })
      }, { merge: true });
    });
  }

  async googlePlaySubscriptionToken(input: {
    uid: string;
    providerSubscriptionId: string;
  }): Promise<string> {
    const snapshot = await this.providerSecretRef("google_play", input.providerSubscriptionId).get();
    if (!snapshot.exists) throw new Error("Encrypted Google Play subscription token is unavailable.");
    const data = snapshot.data() as {
      provider?: string;
      providerSubscriptionId?: string;
      uid?: string;
      encrypted?: EncryptedProviderToken;
    };
    if (
      data.provider !== "google_play" ||
      data.providerSubscriptionId !== input.providerSubscriptionId ||
      data.uid !== input.uid ||
      !data.encrypted
    ) {
      throw new Error("Encrypted Google Play subscription token metadata is invalid.");
    }
    return decryptProviderToken(
      data.encrypted,
      this.providerTokenAssociatedData("google_play", input.providerSubscriptionId, input.uid)
    );
  }

  async deleteGooglePlaySubscriptionToken(providerSubscriptionId: string): Promise<void> {
    await this.providerSecretRef("google_play", providerSubscriptionId).delete();
  }

  async storeAccountToken(uid: string, now: Date): Promise<string> {
    const userRef = this.db.collection("users").doc(uid);
    const candidate = randomUUID();
    const tokenRef = this.db.collection("storeAccountTokens").doc(stableDocumentId("store-account", candidate));
    return this.db.runTransaction(async (transaction) => {
      const user = await transaction.get(userRef);
      const existing = user.data()?.storeAccountToken as string | undefined;
      if (existing) return existing;
      transaction.set(userRef, { storeAccountToken: candidate, updatedAt: now.toISOString() }, { merge: true });
      transaction.create(tokenRef, { uid, token: candidate, createdAt: now.toISOString() });
      return candidate;
    });
  }

  async uidForStoreAccountToken(token: string): Promise<string | undefined> {
    const snapshot = await this.db.collection("storeAccountTokens").doc(
      stableDocumentId("store-account", token)
    ).get();
    return snapshot.data()?.uid as string | undefined;
  }

  async activeSubscription(uid: string): Promise<{
    provider: "stripe" | "google_play" | "apple";
    providerSubscriptionId: string;
  } | undefined> {
    const grants = await this.grantsForUid(uid);
    const active = grants.find((grant) =>
      grant.product === "mobile_full_monthly" &&
      (grant.state === "active" || grant.state === "grace") &&
      Boolean(grant.providerSubscriptionId) &&
      (grant.provider === "stripe" || grant.provider === "google_play" || grant.provider === "apple")
    );
    if (!active?.providerSubscriptionId) return undefined;
    return {
      provider: active.provider as "stripe" | "google_play" | "apple",
      providerSubscriptionId: active.providerSubscriptionId
    };
  }

  async enqueue(kind: OutboxKind, dedupeKey: string, payload: Record<string, unknown>, now: Date, notBefore = now): Promise<boolean> {
    const ref = this.db.collection("outbox").doc(stableDocumentId(kind, dedupeKey));
    return this.db.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      if (current.exists) return false;
      const job: OutboxJob = {
        id: ref.id,
        kind,
        dedupeKey,
        createdAt: now.toISOString(),
        notBefore: notBefore.toISOString(),
        attemptCount: 0,
        state: "pending",
        payload
      };
      transaction.create(ref, job);
      return true;
    });
  }

  async saveCheckoutContext(
    sessionId: string,
    context: {
      uid: string;
      ipAddress?: string;
      userAgent?: string;
      fbp?: string;
      fbc?: string;
      ttclid?: string;
      ttp?: string;
    },
    now: Date
  ): Promise<void> {
    await this.db.collection("checkoutContexts").doc(sessionId).set({
      ...context,
      createdAt: now.toISOString()
    }, { merge: true });
  }

  async checkoutContext(sessionId: string): Promise<Record<string, unknown> | undefined> {
    const snapshot = await this.db.collection("checkoutContexts").doc(sessionId).get();
    return snapshot.exists ? snapshot.data() : undefined;
  }

  async linkCheckoutContextToSubscription(sessionId: string, subscriptionId: string, now: Date): Promise<void> {
    const context = await this.checkoutContext(sessionId);
    await this.db.collection("subscriptionContexts").doc(
      stableDocumentId("subscription", subscriptionId)
    ).set({
      ...(context ?? {}),
      checkoutSessionId: sessionId,
      subscriptionId,
      linkedAt: now.toISOString()
    }, { merge: true });
  }

  async subscriptionContext(subscriptionId: string): Promise<Record<string, unknown> | undefined> {
    const snapshot = await this.db.collection("subscriptionContexts").doc(
      stableDocumentId("subscription", subscriptionId)
    ).get();
    return snapshot.exists ? snapshot.data() : undefined;
  }

  async saveLegacyOrder(order: LegacyOrder): Promise<boolean> {
    const ref = this.db.collection("legacyOrders").doc(order.id);
    return this.db.runTransaction(async (transaction) => {
      if ((await transaction.get(ref)).exists) return false;
      transaction.create(ref, order);
      return true;
    });
  }

  async claimLegacyOrder(input: { uid: string; email: string; checkoutSessionId: string; now: Date }): Promise<LegacyDiscountClaim> {
    const orderRef = this.db.collection("legacyOrders").doc(input.checkoutSessionId);
    const claimRef = this.db.collection("legacyDiscountClaims").doc(input.uid);
    return this.db.runTransaction(async (transaction) => {
      const [orderSnapshot, claimSnapshot] = await Promise.all([
        transaction.get(orderRef),
        transaction.get(claimRef)
      ]);
      if (!orderSnapshot.exists) throw new Error("The historical order has not been imported or verified.");
      const order = orderSnapshot.data() as LegacyOrder & { claimedByUid?: string; buyerEmail?: string };
      if (order.claimedByUid && order.claimedByUid !== input.uid) {
        throw new Error("This historical order is already claimed by another account.");
      }
      if (!order.buyerEmail || order.buyerEmail.toLowerCase() !== input.email.toLowerCase()) {
        throw new Error("The receipt email does not match the verified account email.");
      }
      const current = claimSnapshot.data() as LegacyDiscountClaim | undefined;
      const transactionIds = new Set(current?.verifiedDesktopTransactionIds ?? []);
      transactionIds.add(input.checkoutSessionId);
      const claim: LegacyDiscountClaim = {
        uid: input.uid,
        verifiedDesktopTransactionIds: [...transactionIds].sort(),
        ...(current?.redeemedAt ? { redeemedAt: current.redeemedAt } : {}),
        ...(current?.reservedCheckoutSessionId ? { reservedCheckoutSessionId: current.reservedCheckoutSessionId } : {}),
        ...(current?.reservationExpiresAt ? { reservationExpiresAt: current.reservationExpiresAt } : {})
      };
      transaction.set(claimRef, { ...claim, updatedAt: input.now.toISOString() });
      transaction.set(orderRef, { claimedByUid: input.uid, claimedAt: input.now.toISOString() }, { merge: true });
      return claim;
    });
  }

  async legacyDiscountClaim(uid: string): Promise<LegacyDiscountClaim | undefined> {
    const snapshot = await this.db.collection("legacyDiscountClaims").doc(uid).get();
    return snapshot.exists ? snapshot.data() as LegacyDiscountClaim : undefined;
  }

  async reserveLegacyDiscount(uid: string, checkoutSessionId: string, expiresAt: Date, now: Date): Promise<void> {
    const ref = this.db.collection("legacyDiscountClaims").doc(uid);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error("No verified historical desktop purchase is linked to this account.");
      const claim = snapshot.data() as LegacyDiscountClaim;
      if (claim.redeemedAt) throw new Error("The historical-customer discount has already been used.");
      if (claim.reservedCheckoutSessionId && claim.reservationExpiresAt && Date.parse(claim.reservationExpiresAt) > now.getTime()) {
        if (claim.reservedCheckoutSessionId === checkoutSessionId) return;
        throw new Error("A discounted checkout is already active for this account.");
      }
      transaction.update(ref, {
        reservedCheckoutSessionId: checkoutSessionId,
        reservationExpiresAt: expiresAt.toISOString(),
        updatedAt: now.toISOString()
      });
    });
  }

  async redeemLegacyDiscount(uid: string, checkoutSessionId: string, now: Date): Promise<void> {
    const ref = this.db.collection("legacyDiscountClaims").doc(uid);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error("Discount claim is missing.");
      const claim = snapshot.data() as LegacyDiscountClaim;
      if (claim.redeemedAt) return;
      if (claim.reservedCheckoutSessionId !== checkoutSessionId) {
        throw new Error("The paid checkout does not own this discount reservation.");
      }
      transaction.update(ref, {
        redeemedAt: now.toISOString(),
        redeemedCheckoutSessionId: checkoutSessionId,
        reservedCheckoutSessionId: null,
        reservationExpiresAt: null,
        updatedAt: now.toISOString()
      });
    });
  }

  async releaseLegacyDiscount(uid: string, checkoutSessionId: string, now: Date): Promise<void> {
    const ref = this.db.collection("legacyDiscountClaims").doc(uid);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const claim = snapshot.data() as LegacyDiscountClaim | undefined;
      if (!claim || claim.redeemedAt || claim.reservedCheckoutSessionId !== checkoutSessionId) return;
      transaction.update(ref, {
        reservedCheckoutSessionId: null,
        reservationExpiresAt: null,
        updatedAt: now.toISOString()
      });
    });
  }

  async leaseOutboxJobs(workerId: string, now: Date, limit = 20): Promise<OutboxJob[]> {
    const candidates = await this.db.collection("outbox").where("state", "in", ["pending", "processing"]).limit(limit * 3).get();
    const leased: OutboxJob[] = [];
    for (const candidate of candidates.docs) {
      if (leased.length >= limit) break;
      const job = await this.db.runTransaction(async (transaction): Promise<OutboxJob | undefined> => {
        const fresh = await transaction.get(candidate.ref);
        if (!fresh.exists) return undefined;
        const data = fresh.data() as OutboxJob & { leaseExpiresAt?: string };
        const leaseExpired = data.state === "processing" &&
          Boolean(data.leaseExpiresAt) && Date.parse(data.leaseExpiresAt as string) <= now.getTime();
        if (data.state !== "pending" && !leaseExpired) return undefined;
        if (Date.parse(data.notBefore) > now.getTime()) return undefined;
        const updated: OutboxJob = {
          ...data,
          state: "processing",
          attemptCount: data.attemptCount + 1
        };
        transaction.update(candidate.ref, {
          state: "processing",
          attemptCount: updated.attemptCount,
          workerId,
          leasedAt: now.toISOString(),
          leaseExpiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString()
        });
        return updated;
      });
      if (job) leased.push(job);
    }
    return leased;
  }

  async completeOutboxJob(jobId: string, now: Date, result?: Record<string, unknown>): Promise<void> {
    await this.db.collection("outbox").doc(jobId).update({
      state: "complete",
      completedAt: now.toISOString(),
      leaseExpiresAt: null,
      workerId: null,
      // Delivery payloads can contain short-lived attribution or fulfillment
      // identifiers. Dedupe key, kind, timestamps, and result are sufficient
      // after successful delivery.
      payload: { redacted: true, redactedAt: now.toISOString() },
      ...(result ? { result } : {})
    });
  }

  async failOutboxJob(job: OutboxJob, error: unknown, now: Date): Promise<void> {
    const terminal = job.attemptCount >= 10;
    const retryMinutes = Math.min(6 * 60, Math.max(1, 2 ** Math.min(job.attemptCount, 8)));
    await this.db.collection("outbox").doc(job.id).update({
      state: terminal ? "failed" : "pending",
      lastError: safeErrorMessage(error, "Unknown worker error"),
      lastFailedAt: now.toISOString(),
      notBefore: new Date(now.getTime() + retryMinutes * 60 * 1000).toISOString(),
      leaseExpiresAt: null,
      workerId: null
    });
  }
}
