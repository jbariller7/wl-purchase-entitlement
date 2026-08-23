import { randomUUID } from "node:crypto";
import type { Firestore, Query } from "firebase-admin/firestore";
import type { Auth, UserRecord } from "firebase-admin/auth";
import type { Product } from "../domain/model.js";
import { EntitlementStore } from "../infrastructure/entitlement-store.js";
import { SHEET_TAB_BY_PRODUCT } from "../legacy/catalog.js";
import { stripeClient } from "../providers/stripe/client.js";
import { recordAdminAudit, type AdminActor } from "./audit.js";

const ADMIN_GRANT_PRODUCTS: Product[] = [
  "mobile_full_lifetime",
  "legacy_mobile_full",
  "legacy_chapter_1",
  "legacy_chapter_2",
  "legacy_chapter_3",
  "legacy_chapter_4"
];

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

export class AdminOperationsService {
  private readonly store: EntitlementStore;

  constructor(private readonly db: Firestore, private readonly auth: Auth) {
    this.store = new EntitlementStore(db);
  }

  private async count(query: Query): Promise<number> {
    return (await query.count().get()).data().count;
  }

  async inventorySummary(): Promise<Array<{ sheetTab: string; available: number; assigned: number }>> {
    const tabs = [...new Set(Object.values(SHEET_TAB_BY_PRODUCT))].sort();
    return Promise.all(tabs.map(async (sheetTab) => {
      const base = this.db.collection("legacyKeys").where("sheetTab", "==", sheetTab);
      const [available, assigned] = await Promise.all([
        this.count(base.where("state", "==", "available")),
        this.count(base.where("state", "==", "assigned"))
      ]);
      return { sheetTab, available, assigned };
    }));
  }

  async overview(): Promise<Record<string, unknown>> {
    const entitlements = this.db.collection("entitlements");
    const [activeSubscriptions, lifetimeCustomers, graceSubscriptions, failedOutbox, failedEvents, inventory, recent] = await Promise.all([
      this.count(entitlements.where("accessKind", "==", "subscription").where("subscriptionState", "==", "active")),
      this.count(entitlements.where("accessKind", "==", "lifetime")),
      this.count(entitlements.where("subscriptionState", "==", "grace")),
      this.count(this.db.collection("outbox").where("state", "==", "failed")),
      this.count(this.db.collection("providerEvents").where("status", "==", "failed")),
      this.inventorySummary(),
      this.db.collection("grants").orderBy("startsAt", "desc").limit(12).get()
    ]);
    const recentRows = dataRows(recent);
    const users = new Map<string, UserRecord | undefined>();
    await Promise.all([...new Set(recentRows.map((row) => String(row.uid ?? "")).filter(Boolean))].map(async (uid) => {
      users.set(uid, await this.auth.getUser(uid).catch(() => undefined));
    }));
    const lowStock = inventory.filter((row) => row.available <= 10);
    const failedOperations = failedOutbox + failedEvents;
    const alerts = [
      ...(failedOperations ? [{ tone: "danger", title: `${failedOperations} operation${failedOperations === 1 ? "" : "s"} need attention`, detail: "Review failed webhooks and retryable jobs", action: "Open operations" }] : []),
      ...lowStock.slice(0, 3).map((row) => ({ tone: "warning", title: `${row.sheetTab} inventory is low`, detail: `${row.available} keys available`, action: "Review inventory" })),
      ...(graceSubscriptions ? [{ tone: "neutral", title: `${graceSubscriptions} subscription${graceSubscriptions === 1 ? " is" : "s are"} in payment grace`, detail: "Stripe access remains available for up to seven days", action: "View customers" }] : [])
    ];
    return {
      metrics: { activeSubscriptions, lifetimeCustomers, graceSubscriptions, failedOperations },
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
    if (!value) throw new Error("Enter an exact Firebase UID or email address.");
    const user = value.includes("@")
      ? await this.auth.getUserByEmail(value.toLowerCase())
      : await this.auth.getUser(value);
    return this.customerDetail(user.uid);
  }

  async customerDetail(uid: string): Promise<Record<string, unknown>> {
    const [user, entitlements, grants, discount, userDoc, cloudSlots] = await Promise.all([
      this.auth.getUser(uid),
      this.store.effectiveEntitlements(uid, new Date()),
      this.store.grantsForUid(uid),
      this.store.legacyDiscountClaim(uid),
      this.db.collection("users").doc(uid).get(),
      this.db.collection("cloudSaves").doc(uid).collection("slots").get()
    ]);
    const stripeCustomerId = userDoc.data()?.stripeCustomerId as string | undefined;
    const paymentIntents = stripeCustomerId
      ? await stripeClient().paymentIntents.list({ customer: stripeCustomerId, limit: 20 })
      : undefined;
    return {
      user: publicUser(user),
      entitlements,
      grants: grants.sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt)),
      legacyDiscount: discount ?? null,
      stripeCustomerId: stripeCustomerId ?? null,
      payments: paymentIntents?.data.map((payment) => ({
        id: payment.id,
        amount: payment.amount,
        amountReceived: payment.amount_received,
        currency: payment.currency.toUpperCase(),
        status: payment.status,
        createdAt: new Date(payment.created * 1000).toISOString(),
        description: payment.description,
        metadata: payment.metadata
      })) ?? [],
      cloudSaves: dataRows(cloudSlots)
    };
  }

  async createGrant(input: {
    actor: AdminActor;
    uid: string;
    product: Product;
    reason: string;
    endsAt?: string;
    now: Date;
  }): Promise<Record<string, unknown>> {
    if (!ADMIN_GRANT_PRODUCTS.includes(input.product)) throw new Error("This product cannot be granted manually.");
    if (input.reason.trim().length < 10) throw new Error("A clear audit reason of at least ten characters is required.");
    await this.auth.getUser(input.uid);
    const transactionId = `manual-${randomUUID()}`;
    const endsAt = input.endsAt ? new Date(input.endsAt) : undefined;
    if (endsAt && (!Number.isFinite(endsAt.getTime()) || endsAt <= input.now)) throw new Error("Grant expiry must be a valid future date.");
    await this.store.upsertGrant({
      id: "",
      uid: input.uid,
      provider: "admin",
      providerTransactionId: transactionId,
      product: input.product,
      state: "active",
      startsAt: input.now.toISOString(),
      ...(endsAt ? { endsAt: endsAt.toISOString() } : {}),
      metadata: { reason: input.reason.trim(), actorUid: input.actor.uid }
    }, { id: `admin-grant:${transactionId}`, created: Math.floor(input.now.getTime() / 1000) });
    await recordAdminAudit({
      db: this.db, actor: input.actor, action: "grant.create", targetType: "user", targetId: input.uid,
      summary: `Granted ${input.product}`, metadata: { transactionId, reason: input.reason.trim(), endsAt: endsAt?.toISOString() ?? null }, now: input.now
    });
    return this.customerDetail(input.uid);
  }

  async revokeAdminGrant(input: { actor: AdminActor; grantId: string; reason: string; now: Date }): Promise<Record<string, unknown>> {
    if (input.reason.trim().length < 10) throw new Error("A clear audit reason of at least ten characters is required.");
    const snapshot = await this.db.collection("grants").doc(input.grantId).get();
    if (!snapshot.exists) throw new Error("Grant not found.");
    const grant = snapshot.data() as { provider: string; providerTransactionId: string; product: Product; uid: string };
    if (grant.provider !== "admin") throw new Error("Only manual administrator grants can be revoked here. Use the provider refund/revoke workflow for paid access.");
    await this.store.revokeByProviderTransaction({
      provider: "admin", providerTransactionId: grant.providerTransactionId, state: "revoked",
      sourceEvent: { id: `admin-revoke:${randomUUID()}`, created: Math.floor(input.now.getTime() / 1000) }, at: input.now
    });
    await recordAdminAudit({
      db: this.db, actor: input.actor, action: "grant.revoke", targetType: "grant", targetId: input.grantId,
      summary: `Revoked ${grant.product}`, metadata: { uid: grant.uid, reason: input.reason.trim() }, now: input.now
    });
    return this.customerDetail(grant.uid);
  }

  async updateUserAccess(input: { actor: AdminActor; uid: string; disabled: boolean; reason: string; now: Date }): Promise<Record<string, unknown>> {
    if (input.reason.trim().length < 10) throw new Error("A clear audit reason of at least ten characters is required.");
    const user = await this.auth.updateUser(input.uid, { disabled: input.disabled });
    await this.auth.revokeRefreshTokens(input.uid);
    await recordAdminAudit({
      db: this.db, actor: input.actor, action: input.disabled ? "user.disable" : "user.enable", targetType: "user", targetId: input.uid,
      summary: input.disabled ? "Disabled sign-in and revoked sessions" : "Re-enabled sign-in",
      metadata: { reason: input.reason.trim() }, now: input.now
    });
    return { user: publicUser(user) };
  }

  async revokeSessions(input: { actor: AdminActor; uid: string; reason: string; now: Date }): Promise<void> {
    if (input.reason.trim().length < 10) throw new Error("A clear audit reason of at least ten characters is required.");
    await this.auth.revokeRefreshTokens(input.uid);
    await recordAdminAudit({
      db: this.db, actor: input.actor, action: "user.sessions.revoke", targetType: "user", targetId: input.uid,
      summary: "Revoked all Firebase sessions", metadata: { reason: input.reason.trim() }, now: input.now
    });
  }

  async operations(): Promise<Record<string, unknown>> {
    const [events, outbox] = await Promise.all([
      this.db.collection("providerEvents").orderBy("receivedAt", "desc").limit(80).get(),
      this.db.collection("outbox").orderBy("createdAt", "desc").limit(80).get()
    ]);
    return { providerEvents: dataRows(events), outbox: dataRows(outbox) };
  }

  async retryOutbox(input: { actor: AdminActor; jobId: string; reason: string; now: Date }): Promise<void> {
    if (input.reason.trim().length < 10) throw new Error("A clear audit reason is required.");
    const ref = this.db.collection("outbox").doc(input.jobId);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error("Outbox job not found.");
      if (snapshot.data()?.state !== "failed") throw new Error("Only terminal failed jobs can be manually retried.");
      transaction.update(ref, { state: "pending", attemptCount: 0, notBefore: input.now.toISOString(), lastError: null, manuallyRetriedAt: input.now.toISOString() });
    });
    await recordAdminAudit({ db: this.db, actor: input.actor, action: "outbox.retry", targetType: "outbox", targetId: input.jobId, summary: "Reset failed job for retry", metadata: { reason: input.reason.trim() }, now: input.now });
  }

  async releaseProviderEvent(input: { actor: AdminActor; eventId: string; reason: string; now: Date }): Promise<void> {
    if (input.reason.trim().length < 10) throw new Error("A clear audit reason is required.");
    const ref = this.db.collection("providerEvents").doc(input.eventId);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error("Provider event not found.");
    if (snapshot.data()?.status !== "failed") throw new Error("Only failed provider events can be released.");
    await ref.update({ status: "failed", lastAttemptAt: null, releasedForRedeliveryAt: input.now.toISOString() });
    await recordAdminAudit({ db: this.db, actor: input.actor, action: "provider_event.release", targetType: "providerEvent", targetId: input.eventId, summary: "Released failed event for provider redelivery", metadata: { reason: input.reason.trim() }, now: input.now });
  }

  async inventory(): Promise<Record<string, unknown>> {
    const [summary, recent] = await Promise.all([
      this.inventorySummary(),
      this.db.collection("legacyFulfillments").orderBy("createdAt", "desc").limit(30).get()
    ]);
    return { summary, recentFulfillments: dataRows(recent) };
  }

  async audit(limit = 100): Promise<Record<string, unknown>> {
    const snapshot = await this.db.collection("adminAudit").orderBy("createdAt", "desc").limit(Math.min(Math.max(limit, 1), 200)).get();
    return { entries: dataRows(snapshot) };
  }
}
