import { randomUUID } from "node:crypto";
import { FieldValue, type Firestore, type Query } from "firebase-admin/firestore";
import type { Auth, UserRecord } from "firebase-admin/auth";
import type { LedgerGrant, Product, Provider } from "../domain/model.js";
import { summarizeSubscription } from "../domain/account-summary.js";
import { HttpError } from "../http/auth.js";
import { invalidateDeviceSignInsForUid } from "../device-sign-in/service.js";
import { EntitlementStore } from "../infrastructure/entitlement-store.js";
import { SHEET_TAB_BY_PRODUCT } from "../legacy/catalog.js";
import { stripeClient } from "../providers/stripe/client.js";
import { recordAdminAudit, type AdminActor } from "./audit.js";
import { AccountDeletionService } from "../account-deletion/service.js";
import { chapterMigrationTransactionId, isLegacyChapterProduct } from "../domain/legacy-chapter-migration.js";
import { assertKnownInventoryTabs, inventoryStockPolicyFromEnvironment, inventoryThresholdFor } from "../config/inventory-policy.js";
import { SecondPlatformRequestService } from "../premium/second-platform-request-service.js";
import { safeErrorMessage } from "../infrastructure/safe-error.js";

const ADMIN_GRANT_PRODUCTS: Product[] = [
  "mobile_polyglot_permanent",
  "premium_lifetime_pass"
];
const CLEANUP_JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLOUD_SAVE_SLOT = /^save(?:0|[1-9]|1[0-9]|20)$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

function safeOperationalTimestamp(value: unknown): string | null {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function publicUser(user: UserRecord) {
  return {
    uid: user.uid,
    email: user.email ?? null,
    emailVerified: user.emailVerified,
    disabled: user.disabled,
    providers: user.providerData.map((provider) => provider.providerId),
    createdAt: user.metadata.creationTime,
    lastSignInAt: user.metadata.lastSignInTime ?? null
  };
}

function dataRows(snapshot: FirebaseFirestore.QuerySnapshot): Array<Record<string, unknown>> {
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

interface PublicCloudSaveRevision {
  revision: string;
  updatedAt: string | null;
  current: boolean;
}

export function publicCloudSaveSummary(documentId: string, value: Record<string, unknown>): Record<string, unknown> {
  const storedSlot = typeof value.slot === "string" && CLOUD_SAVE_SLOT.test(value.slot) ? value.slot : documentId;
  const slot = CLOUD_SAVE_SLOT.test(storedSlot) ? storedSlot : "invalid";
  const currentRevision = typeof value.currentRevision === "string" && CLEANUP_JOB_ID.test(value.currentRevision)
    ? value.currentRevision
    : null;
  const revisions: PublicCloudSaveRevision[] = currentRevision ? [{
    revision: currentRevision,
    updatedAt: safeOperationalTimestamp(value.updatedAt),
    current: true
  }] : [];
  if (Array.isArray(value.previousRevisions)) {
    for (const item of value.previousRevisions) {
      if (!item || typeof item !== "object") continue;
      const candidate = item as Record<string, unknown>;
      if (typeof candidate.revision !== "string" || !CLEANUP_JOB_ID.test(candidate.revision)) continue;
      if (candidate.revision === currentRevision || revisions.some((revision) => revision.revision === candidate.revision)) continue;
      revisions.push({
        revision: candidate.revision,
        updatedAt: safeOperationalTimestamp(candidate.updatedAt),
        current: false
      });
    }
  }
  return {
    id: documentId,
    slot,
    currentRevision,
    byteLength: typeof value.byteLength === "number" && Number.isSafeInteger(value.byteLength) && value.byteLength >= 0
      ? value.byteLength
      : null,
    sha256: typeof value.sha256 === "string" && SHA256_HEX.test(value.sha256) ? value.sha256 : null,
    updatedAt: safeOperationalTimestamp(value.updatedAt),
    retainedRevisionCount: revisions.length,
    revisions
  };
}

function nonNegativeInteger(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function operationalLabel(value: unknown, fallback: string): string {
  return typeof value === "string" && /^[a-z0-9_.:-]{1,80}$/i.test(value) ? value : fallback;
}

function operationalError(value: unknown): string | null {
  return typeof value === "string" && value ? safeErrorMessage(value) : null;
}

export function publicOutboxSummary(documentId: string, value: Record<string, unknown>): Record<string, unknown> {
  return {
    id: documentId,
    kind: operationalLabel(value.kind, "unknown"),
    state: operationalLabel(value.state, "unknown"),
    attemptCount: nonNegativeInteger(value.attemptCount),
    createdAt: safeOperationalTimestamp(value.createdAt),
    notBefore: safeOperationalTimestamp(value.notBefore),
    completedAt: safeOperationalTimestamp(value.completedAt),
    lastError: operationalError(value.lastError)
  };
}

export function publicProviderEventSummary(documentId: string, value: Record<string, unknown>): Record<string, unknown> {
  return {
    id: documentId,
    provider: operationalLabel(value.provider, "unknown"),
    eventType: operationalLabel(value.eventType, "unknown"),
    status: operationalLabel(value.status, "unknown"),
    attemptCount: nonNegativeInteger(value.attemptCount),
    receivedAt: safeOperationalTimestamp(value.receivedAt),
    processedAt: safeOperationalTimestamp(value.processedAt),
    lastError: operationalError(value.lastError)
  };
}

export function publicReconciliationRunSummary(documentId: string, value: Record<string, unknown>): Record<string, unknown> {
  return {
    id: documentId,
    state: operationalLabel(value.state, "unknown"),
    startedAt: safeOperationalTimestamp(value.startedAt),
    finishedAt: safeOperationalTimestamp(value.finishedAt),
    bootstrapped: nonNegativeInteger(value.bootstrapped),
    attempted: nonNegativeInteger(value.attempted),
    succeeded: nonNegativeInteger(value.succeeded),
    failed: nonNegativeInteger(value.failed),
    providerAccess: "read_only",
    lastError: operationalError(value.lastError)
  };
}

export function publicFulfillmentSummary(documentId: string, value: Record<string, unknown>): Record<string, unknown> {
  return {
    id: documentId,
    orderId: typeof value.orderId === "string" && value.orderId.length <= 180 ? value.orderId : documentId,
    createdAt: safeOperationalTimestamp(value.createdAt),
    mirroredToSheetAt: safeOperationalTimestamp(value.mirroredToSheetAt),
    syncedToMailerLiteAt: safeOperationalTimestamp(value.syncedToMailerLiteAt),
    keyCount: Array.isArray(value.keys) ? value.keys.length : 0
  };
}

export function publicGrantSummary(grant: LedgerGrant): Record<string, unknown> {
  return {
    id: grant.id,
    provider: grant.provider,
    product: grant.product,
    state: grant.state,
    startsAt: safeOperationalTimestamp(grant.startsAt),
    currentPeriodEndsAt: safeOperationalTimestamp(grant.currentPeriodEndsAt),
    graceEndsAt: safeOperationalTimestamp(grant.graceEndsAt),
    endsAt: safeOperationalTimestamp(grant.endsAt),
    refundedAt: safeOperationalTimestamp(grant.refundedAt),
    metadata: grant.metadata?.migration === true ? { migration: true } : {}
  };
}

export function publicDeletionRequest(value: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!value) return null;
  return {
    state: operationalLabel(value.state, "unknown"),
    requestedAt: safeOperationalTimestamp(value.requestedAt),
    deleteAfter: safeOperationalTimestamp(value.deleteAfter),
    recoveryDays: nonNegativeInteger(value.recoveryDays),
    canceledAt: safeOperationalTimestamp(value.canceledAt)
  };
}

export class AdminOperationsService {
  private readonly store: EntitlementStore;
  private readonly secondPlatformRequests: SecondPlatformRequestService;

  constructor(private readonly db: Firestore, private readonly auth: Auth) {
    this.store = new EntitlementStore(db);
    this.secondPlatformRequests = new SecondPlatformRequestService(db);
  }

  private async count(query: Query): Promise<number> {
    return (await query.count().get()).data().count;
  }

  async inventorySummary(): Promise<Array<{ sheetTab: string; available: number; assigned: number; lowStockThreshold: number; lowStock: boolean }>> {
    const tabs = [...new Set(Object.values(SHEET_TAB_BY_PRODUCT))].sort();
    const policy = inventoryStockPolicyFromEnvironment();
    assertKnownInventoryTabs(policy, tabs);
    return Promise.all(tabs.map(async (sheetTab) => {
      const base = this.db.collection("legacyKeys").where("sheetTab", "==", sheetTab);
      const [available, assigned] = await Promise.all([
        this.count(base.where("state", "==", "available")),
        this.count(base.where("state", "==", "assigned"))
      ]);
      const lowStockThreshold = inventoryThresholdFor(sheetTab, policy);
      return { sheetTab, available, assigned, lowStockThreshold, lowStock: available <= lowStockThreshold };
    }));
  }

  async overview(): Promise<Record<string, unknown>> {
    const entitlements = this.db.collection("entitlements");
    const [activeSubscriptions, permanentCustomers, premiumCustomers, graceSubscriptions, failedOutbox, failedEvents, failedReconciliations, failedCloudSaveCleanup, openSecondPlatformRequests, inventory, recent, cloudStorage, cloudStorageMonitor, cloudSaveCleanupMonitor] = await Promise.all([
      this.count(entitlements.where("subscriptionState", "==", "active")),
      this.count(entitlements.where("accessKind", "==", "permanent")),
      this.count(entitlements.where("accessKind", "==", "premium_lifetime")),
      this.count(entitlements.where("subscriptionState", "==", "grace")),
      this.count(this.db.collection("outbox").where("state", "==", "failed")),
      this.count(this.db.collection("providerEvents").where("status", "==", "failed")),
      this.count(this.db.collection("providerSubscriptions").where("lastReconciliationState", "==", "failed")),
      this.count(this.db.collection("cloudSaveCleanupJobs").where("state", "==", "failed")),
      Promise.all([
        this.count(this.db.collection("secondPlatformRequests").where("state", "==", "pending")),
        this.count(this.db.collection("secondPlatformRequests").where("state", "==", "approving"))
      ]).then(([pending, approving]) => pending + approving),
      this.inventorySummary(),
      this.db.collection("grants").orderBy("startsAt", "desc").limit(12).get(),
      this.db.collection("operationalMetrics").doc("cloudStorage").get(),
      this.db.collection("operationalMetrics").doc("cloudStorageMonitor").get(),
      this.db.collection("operationalMetrics").doc("cloudSaveCleanup").get()
    ]);
    const recentRows = dataRows(recent);
    const users = new Map<string, UserRecord | undefined>();
    await Promise.all([...new Set(recentRows.map((row) => String(row.uid ?? "")).filter(Boolean))].map(async (uid) => {
      users.set(uid, await this.auth.getUser(uid).catch(() => undefined));
    }));
    const lowStock = inventory.filter((row) => row.lowStock);
    const cloud = cloudStorage.exists ? cloudStorage.data() : undefined;
    const cloudMonitor = cloudStorageMonitor.exists ? cloudStorageMonitor.data() : undefined;
    const cleanupMonitor = cloudSaveCleanupMonitor.exists ? cloudSaveCleanupMonitor.data() : undefined;
    const failedOperations = failedOutbox + failedEvents + failedReconciliations + failedCloudSaveCleanup + (cloudMonitor?.state === "failed" ? 1 : 0) + (cleanupMonitor?.state === "failed" ? 1 : 0);
    const alerts = [
      ...(failedOperations ? [{ view: "operations", tone: "danger", title: `${failedOperations} operation${failedOperations === 1 ? "" : "s"} need attention`, detail: "Review failed webhooks, jobs, provider reconciliation, and cloud-save cleanup", action: "Open operations" }] : []),
      ...(failedCloudSaveCleanup ? [{ view: "operations", tone: "danger", title: `${failedCloudSaveCleanup} cloud-save cleanup job${failedCloudSaveCleanup === 1 ? "" : "s"} failed`, detail: "Obsolete revisions remain retained until cleanup is retried", action: "Open operations" }] : []),
      ...(cloud?.staleUploadAlert ? [{ view: "operations", tone: "warning", title: `${Number(cloud.staleStagingObjects ?? 0)} stale cloud upload${Number(cloud.staleStagingObjects ?? 0) === 1 ? "" : "s"}`, detail: "Expired staging objects should be removed", action: "Open operations" }] : []),
      ...(cloud?.growthAlert ? [{ view: "operations", tone: "warning", title: "Cloud storage growth exceeded its daily threshold", detail: `${Number(cloud.dailyChangeBytes ?? 0).toLocaleString()} bytes since the previous snapshot`, action: "Open operations" }] : []),
      ...(cloudMonitor?.state === "failed" ? [{ view: "operations", tone: "danger", title: "Cloud storage inventory failed", detail: "Review Firebase IAM/billing and the scheduled function status", action: "Open operations" }] : []),
      ...(cleanupMonitor?.state === "failed" ? [{ view: "operations", tone: "danger", title: "Cloud-save cleanup worker failed", detail: "Review Firebase IAM/billing and the scheduled function status", action: "Open operations" }] : []),
      ...(openSecondPlatformRequests ? [{ view: "customers", tone: "neutral", title: `${openSecondPlatformRequests} Premium second-platform request${openSecondPlatformRequests === 1 ? "" : "s"} awaiting review`, detail: "Approve or decline each request with an audit reason", action: "Review requests" }] : []),
      ...lowStock.slice(0, 3).map((row) => ({ view: "inventory", tone: "warning", title: `${row.sheetTab} inventory is low`, detail: `${row.available} keys available · threshold ${row.lowStockThreshold}`, action: "Review inventory" })),
      ...(graceSubscriptions ? [{ view: "customers", tone: "neutral", title: `${graceSubscriptions} subscription${graceSubscriptions === 1 ? " is" : "s are"} in payment grace`, detail: "Stripe access remains available for up to seven days", action: "View customers" }] : [])
    ];
    return {
      metrics: {
        activeSubscriptions,
        permanentCustomers,
        premiumCustomers,
        lifetimeCustomers: permanentCustomers + premiumCustomers,
        graceSubscriptions,
        pendingSecondPlatformRequests: openSecondPlatformRequests,
        failedOperations,
        failedReconciliations,
        failedCloudSaveCleanup,
        cloudStorageBytes: cloud?.totalBytes ?? null,
        cloudStorageDailyChangeBytes: cloud?.dailyChangeBytes ?? null,
        cloudStorageObjects: cloud?.totalObjects ?? null,
        cloudStorageCapturedAt: cloud?.capturedAt ?? null
      },
      alerts,
      activity: recentRows.map((row) => {
        const user = users.get(String(row.uid ?? ""));
        return {
          time: row.startsAt,
          customer: user?.email ?? String(row.uid ?? "Unknown account"),
          event: String(row.product ?? "entitlement"),
          amount: null,
          state: row.state
        };
      }),
      generatedAt: new Date().toISOString()
    };
  }

  async findCustomer(query: string): Promise<Record<string, unknown>> {
    const value = query.trim();
    if (!value) throw new HttpError(400, "Enter an exact email, Firebase UID, Stripe ID, or provider transaction ID.");

    if (value.includes("@")) {
      try { return this.customerDetail((await this.auth.getUserByEmail(value.toLowerCase())).uid); }
      catch (error) {
        if ((error as { code?: string }).code === "auth/user-not-found") throw new HttpError(404, "No WonderLang account uses that exact email address.");
        throw error;
      }
    }

    try { return this.customerDetail((await this.auth.getUser(value)).uid); }
    catch (error) {
      if ((error as { code?: string }).code !== "auth/user-not-found" && (error as { code?: string }).code !== "auth/invalid-uid") throw error;
    }

    const linkedUid = await this.resolveCustomerUid(value);
    if (!linkedUid) throw new HttpError(404, "No WonderLang account is linked to that exact identifier.");
    return this.customerDetail(linkedUid);
  }

  private async resolveCustomerUid(value: string): Promise<string | undefined> {
    if (value.startsWith("cus_")) return this.store.uidForStripeCustomer(value);
    if (value.startsWith("cs_")) {
      const local = await this.store.uidForCheckoutSession(value);
      if (local) return local;
      const session = await stripeClient().checkout.sessions.retrieve(value);
      const metadataUid = session.metadata?.wl_uid || session.client_reference_id || undefined;
      if (metadataUid) return metadataUid;
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
      return customerId ? this.store.uidForStripeCustomer(customerId) : undefined;
    }
    if (value.startsWith("pi_")) {
      const local = await this.store.uidForProviderTransaction("stripe", value);
      if (local) return local;
      const payment = await stripeClient().paymentIntents.retrieve(value);
      const customerId = typeof payment.customer === "string" ? payment.customer : payment.customer?.id;
      return customerId ? this.store.uidForStripeCustomer(customerId) : undefined;
    }
    if (value.startsWith("ch_")) {
      const charge = await stripeClient().charges.retrieve(value);
      const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      if (paymentIntentId) {
        const linked = await this.store.uidForProviderTransaction("stripe", paymentIntentId);
        if (linked) return linked;
      }
      const customerId = typeof charge.customer === "string" ? charge.customer : charge.customer?.id;
      return customerId ? this.store.uidForStripeCustomer(customerId) : undefined;
    }
    if (value.startsWith("sub_")) {
      const local = await this.store.uidForProviderSubscription("stripe", value);
      if (local) return local;
      const subscription = await stripeClient().subscriptions.retrieve(value);
      const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
      return this.store.uidForStripeCustomer(customerId);
    }
    const providers: Provider[] = ["stripe", "google_play", "apple", "steam", "itch", "admin"];
    for (const provider of providers) {
      const uid = await this.store.uidForProviderTransaction(provider, value);
      if (uid) return uid;
      const subscriptionUid = await this.store.uidForProviderSubscription(provider, value);
      if (subscriptionUid) return subscriptionUid;
    }
    return undefined;
  }

  async customerDetail(uid: string): Promise<Record<string, unknown>> {
    const [user, entitlements, grants, discount, userDoc, cloudSlots, deletionRequest, secondMobilePlatformRequest] = await Promise.all([
      this.auth.getUser(uid),
      this.store.effectiveEntitlements(uid, new Date()),
      this.store.grantsForUid(uid),
      this.store.legacyDiscountClaim(uid),
      this.db.collection("users").doc(uid).get(),
      this.db.collection("cloudSaves").doc(uid).collection("slots").get(),
      this.db.collection("accountDeletionRequests").doc(uid).get(),
      this.secondPlatformRequests.get(uid)
    ]);
    const stripeCustomerId = userDoc.data()?.stripeCustomerId as string | undefined;
    const paymentIntents = stripeCustomerId
      ? await stripeClient().paymentIntents.list({ customer: stripeCustomerId, limit: 20, expand: ["data.latest_charge"] })
      : undefined;
    const sourceGrantIds = new Set(entitlements.sourceGrantIds);
    return {
      user: publicUser(user),
      entitlements,
      effectiveProducts: [...new Set(grants.filter((grant) => sourceGrantIds.has(grant.id)).map((grant) => grant.product))].sort(),
      subscription: summarizeSubscription(grants),
      grants: grants
        .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))
        .map(publicGrantSummary),
      providerIdentities: grants.map((grant) => ({
        provider: grant.provider,
        product: grant.product,
        customerId: grant.providerCustomerId ?? null,
        transactionId: grant.providerTransactionId,
        subscriptionId: grant.providerSubscriptionId ?? null,
        state: grant.state
      })),
      legacyDiscount: discount ?? null,
      stripeCustomerId: stripeCustomerId ?? null,
      payments: paymentIntents?.data.map((payment) => {
        const charge = typeof payment.latest_charge === "object" && payment.latest_charge && !("deleted" in payment.latest_charge)
          ? payment.latest_charge
          : undefined;
        return {
          id: payment.id,
          amount: payment.amount,
          amountReceived: payment.amount_received,
          amountRefunded: charge?.amount_refunded ?? 0,
          refundableAmount: charge ? Math.max(0, charge.amount - charge.amount_refunded) : 0,
          currency: payment.currency.toUpperCase(),
          status: payment.status,
          createdAt: new Date(payment.created * 1000).toISOString(),
          description: payment.description,
          refunds: charge?.refunds?.data.map((refund) => ({ id: refund.id, amount: refund.amount, status: refund.status, createdAt: new Date(refund.created * 1000).toISOString() })) ?? [],
        };
      }) ?? [],
      // Customer support needs a retained-version timeline, not Firebase
      // Storage coordinates. Never expose manifest UIDs or object paths.
      cloudSaves: cloudSlots.docs.map((doc) => publicCloudSaveSummary(doc.id, doc.data())),
      deletionRequest: publicDeletionRequest(deletionRequest.exists ? deletionRequest.data() : undefined),
      secondMobilePlatformRequest
    };
  }

  async openSecondPlatformRequests(): Promise<Record<string, unknown>> {
    return { requests: await this.secondPlatformRequests.listOpen(100) };
  }

  async approveSecondPlatformRequest(input: { actor: AdminActor; uid: string; reason: string; now: Date }): Promise<Record<string, unknown>> {
    await this.auth.getUser(input.uid);
    await this.secondPlatformRequests.approve(input);
    return this.customerDetail(input.uid);
  }

  async declineSecondPlatformRequest(input: { actor: AdminActor; uid: string; reason: string; now: Date }): Promise<Record<string, unknown>> {
    await this.auth.getUser(input.uid);
    await this.secondPlatformRequests.decline(input);
    return this.customerDetail(input.uid);
  }

  async cancelAccountDeletion(input: { actor: AdminActor; uid: string; reason: string; now: Date }): Promise<Record<string, unknown>> {
    return new AccountDeletionService(this.db, this.auth).cancel(input);
  }

  async createGrant(input: {
    actor: AdminActor;
    uid: string;
    product: Product;
    mobilePlatform?: "android" | "ios";
    reason: string;
    endsAt?: string;
    now: Date;
  }): Promise<Record<string, unknown>> {
    if (!ADMIN_GRANT_PRODUCTS.includes(input.product)) throw new HttpError(400, "This product cannot be granted manually.");
    if ((input.product === "mobile_polyglot_permanent" || input.product === "premium_lifetime_pass") && !input.mobilePlatform) {
      throw new HttpError(400, "Choose Android or iOS as the first mobile platform for this grant.");
    }
    if (input.reason.trim().length < 10) throw new HttpError(400, "A clear audit reason of at least ten characters is required.");
    await this.auth.getUser(input.uid);
    const transactionId = `manual-${randomUUID()}`;
    const endsAt = input.endsAt ? new Date(input.endsAt) : undefined;
    if (endsAt && (!Number.isFinite(endsAt.getTime()) || endsAt <= input.now)) throw new HttpError(400, "Grant expiry must be a valid future date.");
    await this.store.upsertGrant({
      id: "",
      uid: input.uid,
      provider: "admin",
      providerTransactionId: transactionId,
      product: input.product,
      state: "active",
      startsAt: input.now.toISOString(),
      ...(endsAt ? { endsAt: endsAt.toISOString() } : {}),
      metadata: {
        reason: input.reason.trim(),
        actorUid: input.actor.uid,
        ...(input.mobilePlatform ? (input.product === "premium_lifetime_pass"
          ? { primaryMobilePlatform: input.mobilePlatform }
          : { mobilePlatform: input.mobilePlatform }) : {})
      }
    }, { id: `admin-grant:${transactionId}`, created: Math.floor(input.now.getTime() / 1000) });
    await recordAdminAudit({
      db: this.db, actor: input.actor, action: "grant.create", targetType: "user", targetId: input.uid,
      summary: `Granted ${input.product}`, metadata: { transactionId, reason: input.reason.trim(), mobilePlatform: input.mobilePlatform ?? null, endsAt: endsAt?.toISOString() ?? null }, now: input.now
    });
    return this.customerDetail(input.uid);
  }

  async revokeAdminGrant(input: { actor: AdminActor; grantId: string; reason: string; now: Date }): Promise<Record<string, unknown>> {
    if (input.reason.trim().length < 10) throw new HttpError(400, "A clear audit reason of at least ten characters is required.");
    const snapshot = await this.db.collection("grants").doc(input.grantId).get();
    if (!snapshot.exists) throw new HttpError(404, "Grant not found.");
    const grant = snapshot.data() as { provider: string; providerTransactionId: string; product: Product; uid: string };
    if (grant.provider !== "admin") throw new HttpError(409, "Only manual administrator grants can be revoked here. Use the provider refund/revoke workflow for paid access.");
    await this.store.revokeByProviderTransaction({
      provider: "admin", providerTransactionId: grant.providerTransactionId, state: "revoked",
      sourceEvent: { id: `admin-revoke:${randomUUID()}`, created: Math.floor(input.now.getTime() / 1000) }, at: input.now
    });
    if (isLegacyChapterProduct(grant.product)) {
      await this.store.revokeByProviderTransaction({
        provider: "admin",
        providerTransactionId: chapterMigrationTransactionId(grant.providerTransactionId),
        state: "revoked",
        sourceEvent: { id: `admin-revoke-migration:${randomUUID()}`, created: Math.floor(input.now.getTime() / 1000) },
        at: input.now
      });
    }
    await recordAdminAudit({
      db: this.db, actor: input.actor, action: "grant.revoke", targetType: "grant", targetId: input.grantId,
      summary: `Revoked ${grant.product}`, metadata: { uid: grant.uid, reason: input.reason.trim() }, now: input.now
    });
    return this.customerDetail(grant.uid);
  }

  async updateUserAccess(input: { actor: AdminActor; uid: string; disabled: boolean; reason: string; now: Date }): Promise<Record<string, unknown>> {
    if (input.reason.trim().length < 10) throw new HttpError(400, "A clear audit reason of at least ten characters is required.");
    if (input.disabled) await this.auth.updateUser(input.uid, { disabled: true });
    const invalidated = await invalidateDeviceSignInsForUid(this.db, input.uid, input.now);
    await this.auth.revokeRefreshTokens(input.uid);
    const user = input.disabled
      ? await this.auth.getUser(input.uid)
      : await this.auth.updateUser(input.uid, { disabled: false });
    await recordAdminAudit({
      db: this.db, actor: input.actor, action: input.disabled ? "user.disable" : "user.enable", targetType: "user", targetId: input.uid,
      summary: input.disabled ? "Disabled sign-in and revoked sessions" : "Re-enabled sign-in",
      metadata: { reason: input.reason.trim(), ...invalidated }, now: input.now
    });
    return { user: publicUser(user) };
  }

  async revokeSessions(input: { actor: AdminActor; uid: string; reason: string; now: Date }): Promise<void> {
    if (input.reason.trim().length < 10) throw new HttpError(400, "A clear audit reason of at least ten characters is required.");
    const invalidated = await invalidateDeviceSignInsForUid(this.db, input.uid, input.now);
    await this.auth.revokeRefreshTokens(input.uid);
    await recordAdminAudit({
      db: this.db, actor: input.actor, action: "user.sessions.revoke", targetType: "user", targetId: input.uid,
      summary: "Revoked all Firebase sessions and pending device approvals", metadata: { reason: input.reason.trim(), ...invalidated }, now: input.now
    });
  }

  async operations(): Promise<Record<string, unknown>> {
    const [events, outbox, reconciliationRuns, providerSecrets, cloudStorage, cloudStorageMonitor, cloudSaveCleanupMonitor, cleanupPending, cleanupProcessing, cleanupFailed, cleanupFailures, devicePending, deviceApproved, deviceIssuing, deviceConsumed, deviceExpired] = await Promise.all([
      this.db.collection("providerEvents").orderBy("receivedAt", "desc").limit(80).get(),
      this.db.collection("outbox").orderBy("createdAt", "desc").limit(80).get(),
      this.db.collection("subscriptionReconciliationRuns").orderBy("startedAt", "desc").limit(30).get(),
      this.db.collection("providerSecrets").select("encrypted.keyId").get(),
      this.db.collection("operationalMetrics").doc("cloudStorage").get(),
      this.db.collection("operationalMetrics").doc("cloudStorageMonitor").get(),
      this.db.collection("operationalMetrics").doc("cloudSaveCleanup").get(),
      this.count(this.db.collection("cloudSaveCleanupJobs").where("state", "==", "pending")),
      this.count(this.db.collection("cloudSaveCleanupJobs").where("state", "==", "processing")),
      this.count(this.db.collection("cloudSaveCleanupJobs").where("state", "==", "failed")),
      this.db.collection("cloudSaveCleanupJobs").where("state", "==", "failed").limit(50).get(),
      this.count(this.db.collection("deviceSignInSessions").where("state", "==", "pending")),
      this.count(this.db.collection("deviceSignInSessions").where("state", "==", "approved")),
      this.count(this.db.collection("deviceSignInSessions").where("state", "==", "issuing")),
      this.count(this.db.collection("deviceSignInSessions").where("state", "==", "consumed")),
      this.count(this.db.collection("deviceSignInSessions").where("state", "==", "expired"))
    ]);
    const tokensByKeyId = new Map<string, number>();
    for (const secret of providerSecrets.docs) {
      const keyId = secret.get("encrypted.keyId");
      const label = typeof keyId === "string" && keyId ? keyId : "invalid_or_unknown";
      tokensByKeyId.set(label, (tokensByKeyId.get(label) ?? 0) + 1);
    }
    const cleanupMetric = cloudSaveCleanupMonitor.exists ? cloudSaveCleanupMonitor.data() : undefined;
    const cleanupMonitor = cleanupMetric ? {
      state: cleanupMetric.state === "failed" ? "failed" : "succeeded",
      lastRunAt: safeOperationalTimestamp(cleanupMetric.lastRunAt),
      scanned: Math.max(0, Math.trunc(Number(cleanupMetric.scanned) || 0)),
      deleted: Math.max(0, Math.trunc(Number(cleanupMetric.deleted) || 0)),
      failed: Math.max(0, Math.trunc(Number(cleanupMetric.failed) || 0)),
      skipped: Math.max(0, Math.trunc(Number(cleanupMetric.skipped) || 0)),
      lastError: cleanupMetric.state === "failed" ? "Cloud-save cleanup worker failed." : null
    } : null;
    return {
      providerEvents: events.docs.map((doc) => publicProviderEventSummary(doc.id, doc.data())),
      outbox: outbox.docs.map((doc) => publicOutboxSummary(doc.id, doc.data())),
      reconciliationRuns: reconciliationRuns.docs.map((doc) => publicReconciliationRunSummary(doc.id, doc.data())),
      providerTokenVault: {
        encryptedTokens: providerSecrets.size,
        keys: [...tokensByKeyId.entries()].map(([keyId, tokens]) => ({ keyId, tokens })).sort((a, b) => a.keyId.localeCompare(b.keyId))
      },
      deviceSignIn: {
        pending: devicePending,
        approved: deviceApproved,
        issuing: deviceIssuing,
        consumed: deviceConsumed,
        expired: deviceExpired
      },
      cloudStorage: cloudStorage.exists ? cloudStorage.data() : null,
      cloudStorageMonitor: cloudStorageMonitor.exists ? cloudStorageMonitor.data() : null,
      cloudSaveCleanup: {
        pending: cleanupPending,
        processing: cleanupProcessing,
        failed: cleanupFailed,
        monitor: cleanupMonitor,
        failures: cleanupFailures.docs.flatMap((snapshot) => {
          if (!CLEANUP_JOB_ID.test(snapshot.id)) return [];
          const row = snapshot.data();
          return [{
            id: snapshot.id,
            state: "failed",
            attemptCount: Math.max(0, Math.min(10, Math.trunc(Number(row.attemptCount) || 0))),
            createdAt: safeOperationalTimestamp(row.createdAt),
            lastAttemptAt: safeOperationalTimestamp(row.lastAttemptAt),
            lastError: row.lastError === "Cleanup job contained an unsafe object path."
              ? row.lastError
              : "Cloud Storage revision deletion failed."
          }];
        }).sort((a, b) => Date.parse(String(b.lastAttemptAt ?? b.createdAt ?? "")) - Date.parse(String(a.lastAttemptAt ?? a.createdAt ?? "")))
      }
    };
  }

  async retryCloudSaveCleanup(input: { actor: AdminActor; jobId: string; reason: string; now: Date }): Promise<void> {
    if (input.reason.trim().length < 10) throw new HttpError(400, "A clear audit reason is required.");
    const ref = this.db.collection("cloudSaveCleanupJobs").doc(input.jobId);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new HttpError(404, "Cloud-save cleanup job not found.");
      if (snapshot.data()?.state !== "failed") throw new HttpError(409, "Only terminal failed cleanup jobs can be manually retried.");
      transaction.update(ref, {
        state: "pending",
        attemptCount: 0,
        notBefore: input.now.toISOString(),
        lastError: FieldValue.delete(),
        leaseOwner: FieldValue.delete(),
        leaseUntil: FieldValue.delete(),
        manuallyRetriedAt: input.now.toISOString()
      });
    });
    await recordAdminAudit({
      db: this.db,
      actor: input.actor,
      action: "cloud_save_cleanup.retry",
      targetType: "cloudSaveCleanupJob",
      targetId: input.jobId,
      summary: "Reset failed cloud-save cleanup job for retry",
      metadata: { reason: input.reason.trim() },
      now: input.now
    });
  }

  async retryOutbox(input: { actor: AdminActor; jobId: string; reason: string; now: Date }): Promise<void> {
    if (input.reason.trim().length < 10) throw new HttpError(400, "A clear audit reason is required.");
    const ref = this.db.collection("outbox").doc(input.jobId);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new HttpError(404, "Outbox job not found.");
      if (snapshot.data()?.state !== "failed") throw new HttpError(409, "Only terminal failed jobs can be manually retried.");
      transaction.update(ref, { state: "pending", attemptCount: 0, notBefore: input.now.toISOString(), lastError: null, manuallyRetriedAt: input.now.toISOString() });
    });
    await recordAdminAudit({ db: this.db, actor: input.actor, action: "outbox.retry", targetType: "outbox", targetId: input.jobId, summary: "Reset failed job for retry", metadata: { reason: input.reason.trim() }, now: input.now });
  }

  async releaseProviderEvent(input: { actor: AdminActor; eventId: string; reason: string; now: Date }): Promise<void> {
    if (input.reason.trim().length < 10) throw new HttpError(400, "A clear audit reason is required.");
    const ref = this.db.collection("providerEvents").doc(input.eventId);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new HttpError(404, "Provider event not found.");
    if (snapshot.data()?.status !== "failed") throw new HttpError(409, "Only failed provider events can be released.");
    await ref.update({ status: "released", lastAttemptAt: null, releasedForRedeliveryAt: input.now.toISOString() });
    await recordAdminAudit({ db: this.db, actor: input.actor, action: "provider_event.release", targetType: "providerEvent", targetId: input.eventId, summary: "Released failed event for provider redelivery", metadata: { reason: input.reason.trim() }, now: input.now });
  }

  async inventory(): Promise<Record<string, unknown>> {
    const [summary, recent] = await Promise.all([
      this.inventorySummary(),
      this.db.collection("legacyFulfillments").orderBy("createdAt", "desc").limit(30).get()
    ]);
    return {
      summary,
      recentFulfillments: recent.docs.map((doc) => publicFulfillmentSummary(doc.id, doc.data()))
    };
  }

  async audit(limit = 100): Promise<Record<string, unknown>> {
    const cappedLimit = Math.min(Math.max(limit, 1), 200);
    const [snapshot, bootstrapSnapshot] = await Promise.all([
      this.db.collection("adminAudit").orderBy("createdAt", "desc").limit(cappedLimit).get(),
      this.db.collection("adminBootstrapAudit").orderBy("createdAt", "desc").limit(cappedLimit).get()
    ]);
    const bootstrapEntries = dataRows(bootstrapSnapshot).map((entry) => ({
      id: entry.id,
      actorUid: entry.actorUid,
      actorEmail: entry.targetEmail ?? "verified bootstrap administrator",
      action: entry.action ?? "admin_claim.set",
      targetType: "user",
      targetId: entry.targetUid,
      summary: `Initial administrator claim ${String(entry.state ?? "recorded")}`,
      metadata: {
        state: entry.state ?? "unknown",
        signInProvider: entry.signInProvider ?? "unknown",
        ...(entry.completedAt ? { completedAt: entry.completedAt } : {}),
        ...(entry.failedAt ? { failedAt: entry.failedAt } : {})
      },
      createdAt: entry.createdAt
    }));
    const entries = [...dataRows(snapshot), ...bootstrapEntries]
      .sort((left, right) => Date.parse(String(right.createdAt ?? "")) - Date.parse(String(left.createdAt ?? "")))
      .slice(0, cappedLimit);
    return { entries };
  }
}
