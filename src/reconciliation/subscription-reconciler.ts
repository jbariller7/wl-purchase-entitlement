import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { LedgerState } from "../domain/model.js";
import { EntitlementStore } from "../infrastructure/entitlement-store.js";
import { stableDocumentId } from "../infrastructure/ids.js";
import { safeErrorMessage } from "../infrastructure/safe-error.js";
import { reconcileAppleSubscription } from "../providers/apple/service.js";
import { reconcileGooglePlaySubscription } from "../providers/google-play/service.js";
import { reconcileStripeSubscription } from "../providers/stripe/event-processor.js";

const LEASE_MS = 10 * 60 * 1000;
const DAILY_MS = 24 * 60 * 60 * 1000;
const MAX_TARGETS_PER_RUN = 24;
const PROVIDER_CONCURRENCY = 4;

export type ReconciliationProvider = "stripe" | "google_play" | "apple";

export interface SubscriptionReconciliationTarget {
  id: string;
  provider: ReconciliationProvider;
  providerSubscriptionId: string;
  uid: string;
  state: LedgerState;
  reconcileUntil?: string | null;
}

export interface SubscriptionReconciliationResult {
  runId: string;
  state: "complete" | "partial" | "skipped";
  bootstrapped: number;
  attempted: number;
  succeeded: number;
  failed: number;
  reason?: "lease_held";
}

export interface SubscriptionReconciliationRepository {
  acquireLease(runId: string, now: Date): Promise<boolean>;
  releaseLease(runId: string, now: Date): Promise<void>;
  bootstrap(now: Date): Promise<number>;
  beginRun(runId: string, now: Date): Promise<void>;
  due(now: Date, limit: number): Promise<SubscriptionReconciliationTarget[]>;
  markSucceeded(target: SubscriptionReconciliationTarget, runId: string, now: Date): Promise<void>;
  markFailed(target: SubscriptionReconciliationTarget, runId: string, error: unknown, now: Date): Promise<void>;
  finishRun(runId: string, result: Omit<SubscriptionReconciliationResult, "runId">, now: Date): Promise<void>;
  failRun(runId: string, error: unknown, now: Date): Promise<void>;
}

export type SubscriptionReconciliationHandlers = Record<
  ReconciliationProvider,
  (target: SubscriptionReconciliationTarget, input: { runId: string; now: Date }) => Promise<void>
>;

function isProvider(value: unknown): value is ReconciliationProvider {
  return value === "stripe" || value === "google_play" || value === "apple";
}

function isState(value: unknown): value is LedgerState {
  return value === "active" || value === "grace" || value === "pending" || value === "expired" || value === "revoked" || value === "refunded";
}

export class FirestoreSubscriptionReconciliationRepository implements SubscriptionReconciliationRepository {
  constructor(private readonly db: Firestore) {}

  private leaseRef() {
    return this.db.collection("maintenanceLeases").doc("subscription-reconciliation");
  }

  async acquireLease(runId: string, now: Date): Promise<boolean> {
    const ref = this.leaseRef();
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const expiresAt = Date.parse(String(snapshot.data()?.expiresAt ?? ""));
      if (snapshot.exists && Number.isFinite(expiresAt) && expiresAt > now.getTime()) return false;
      transaction.set(ref, {
        owner: runId,
        acquiredAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + LEASE_MS).toISOString()
      });
      return true;
    });
  }

  async releaseLease(runId: string, now: Date): Promise<void> {
    const ref = this.leaseRef();
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (snapshot.data()?.owner !== runId) return;
      transaction.set(ref, { owner: null, releasedAt: now.toISOString(), expiresAt: now.toISOString() }, { merge: true });
    });
  }

  async bootstrap(now: Date): Promise<number> {
    const snapshot = await this.db.collection("grants").where("state", "in", ["active", "grace", "pending"]).get();
    const grants = snapshot.docs
      .map((document) => ({
        ...(document.data() as {
          product?: unknown;
          provider?: unknown;
          providerSubscriptionId?: unknown;
          uid?: unknown;
          state?: unknown;
          metadata?: { accountDeleted?: unknown };
        }),
        id: document.id
      }))
      .filter((grant) =>
        grant.product === "mobile_full_monthly" &&
        isProvider(grant.provider) &&
        isState(grant.state) &&
        typeof grant.providerSubscriptionId === "string" && grant.providerSubscriptionId &&
        typeof grant.uid === "string" && grant.uid &&
        grant.metadata?.accountDeleted !== true
      ) as Array<{
        provider: ReconciliationProvider;
        providerSubscriptionId: string;
        uid: string;
        state: LedgerState;
        id: string;
      }>;
    const unique = new Map(grants.map((grant) => [stableDocumentId(grant.provider, grant.providerSubscriptionId), grant]));
    let bootstrapped = 0;
    const entries = [...unique.entries()];
    for (let offset = 0; offset < entries.length; offset += 400) {
      const chunk = entries.slice(offset, offset + 400);
      const refs = chunk.map(([id]) => this.db.collection("providerSubscriptions").doc(id));
      const existing = refs.length ? await this.db.getAll(...refs) : [];
      const batch = this.db.batch();
      let chunkWrites = 0;
      existing.forEach((snapshot, index) => {
        const grant = chunk[index]?.[1];
        if (!grant) return;
        const data = snapshot.data();
        if (data?.reconciliationDisabledReason) return;
        if (data?.product === "mobile_full_monthly" && typeof data.nextReconciliationAt === "string") return;
        batch.set(snapshot.ref, {
          provider: grant.provider,
          providerSubscriptionId: grant.providerSubscriptionId,
          uid: grant.uid,
          grantId: grant.id,
          product: "mobile_full_monthly",
          state: grant.state,
          nextReconciliationAt: now.toISOString(),
          bootstrappedAt: now.toISOString(),
          updatedAt: now.toISOString()
        }, { merge: true });
        bootstrapped += 1;
        chunkWrites += 1;
      });
      if (chunkWrites) await batch.commit();
    }
    return bootstrapped;
  }

  async beginRun(runId: string, now: Date): Promise<void> {
    await this.db.collection("subscriptionReconciliationRuns").doc(runId).create({
      state: "running",
      startedAt: now.toISOString(),
      providerAccess: "read_only",
      maxTargets: MAX_TARGETS_PER_RUN
    });
  }

  async due(now: Date, limit: number): Promise<SubscriptionReconciliationTarget[]> {
    const snapshot = await this.db.collection("providerSubscriptions")
      .where("nextReconciliationAt", "<=", now.toISOString())
      .orderBy("nextReconciliationAt", "asc")
      .limit(limit)
      .get();
    return snapshot.docs.map((document) => {
      const data = document.data();
      if (!isProvider(data.provider)) throw new Error("Reconciliation target has an unsupported provider.");
      if (!isState(data.state)) throw new Error("Reconciliation target has an invalid ledger state.");
      if (typeof data.providerSubscriptionId !== "string" || !data.providerSubscriptionId) {
        throw new Error("Reconciliation target has no provider subscription ID.");
      }
      if (typeof data.uid !== "string" || !data.uid) throw new Error("Reconciliation target has no account link.");
      return {
        id: document.id,
        provider: data.provider,
        providerSubscriptionId: data.providerSubscriptionId,
        uid: data.uid,
        state: data.state,
        ...(typeof data.reconcileUntil === "string" || data.reconcileUntil === null
          ? { reconcileUntil: data.reconcileUntil as string | null }
          : {})
      };
    });
  }

  async markSucceeded(target: SubscriptionReconciliationTarget, runId: string, now: Date): Promise<void> {
    const ref = this.db.collection("providerSubscriptions").doc(target.id);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return;
      const data = snapshot.data() ?? {};
      if (data.uid !== target.uid || data.reconciliationDisabledReason) {
        transaction.set(ref, {
          nextReconciliationAt: null,
          lastReconciliationState: "disabled",
          lastReconciliationError: null,
          updatedAt: now.toISOString()
        }, { merge: true });
        return;
      }
      const state = data.state as LedgerState | undefined;
      const reconcileUntil = typeof data.reconcileUntil === "string" ? Date.parse(data.reconcileUntil) : Number.NaN;
      const remainsEligible = state === "active" || state === "grace" || state === "pending" ||
        (state === "expired" && Number.isFinite(reconcileUntil) && reconcileUntil > now.getTime());
      transaction.set(ref, {
        lastReconciledAt: now.toISOString(),
        lastReconciliationRunId: runId,
        lastReconciliationState: "succeeded",
        consecutiveReconciliationFailures: 0,
        lastReconciliationError: null,
        nextReconciliationAt: remainsEligible ? new Date(now.getTime() + DAILY_MS).toISOString() : null,
        updatedAt: now.toISOString()
      }, { merge: true });
    });
  }

  async markFailed(target: SubscriptionReconciliationTarget, runId: string, error: unknown, now: Date): Promise<void> {
    const ref = this.db.collection("providerSubscriptions").doc(target.id);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return;
      if (snapshot.data()?.uid !== target.uid || snapshot.data()?.reconciliationDisabledReason) {
        transaction.set(ref, {
          nextReconciliationAt: null,
          lastReconciliationState: "disabled",
          lastReconciliationError: null,
          updatedAt: now.toISOString()
        }, { merge: true });
        return;
      }
      const failures = Math.min(20, Number(snapshot.data()?.consecutiveReconciliationFailures ?? 0) + 1);
      const delay = Math.min(DAILY_MS, 15 * 60 * 1000 * (2 ** Math.min(failures - 1, 7)));
      transaction.set(ref, {
        lastReconciledAt: now.toISOString(),
        lastReconciliationRunId: runId,
        lastReconciliationState: "failed",
        consecutiveReconciliationFailures: failures,
        lastReconciliationError: safeErrorMessage(error, "Provider reconciliation failed"),
        nextReconciliationAt: new Date(now.getTime() + delay).toISOString(),
        updatedAt: now.toISOString()
      }, { merge: true });
    });
  }

  async finishRun(runId: string, result: Omit<SubscriptionReconciliationResult, "runId">, now: Date): Promise<void> {
    await this.db.collection("subscriptionReconciliationRuns").doc(runId).set({
      ...result,
      finishedAt: now.toISOString()
    }, { merge: true });
  }

  async failRun(runId: string, error: unknown, now: Date): Promise<void> {
    await this.db.collection("subscriptionReconciliationRuns").doc(runId).set({
      state: "failed",
      failedAt: now.toISOString(),
      lastError: safeErrorMessage(error, "Subscription reconciliation failed")
    }, { merge: true });
  }
}

function defaultHandlers(store: EntitlementStore): SubscriptionReconciliationHandlers {
  return {
    stripe: async (target, input) => {
      const result = await reconcileStripeSubscription({
        store,
        providerSubscriptionId: target.providerSubscriptionId,
        eventId: `reconcile:${input.runId}:${target.id}`,
        eventCreated: Math.floor(input.now.getTime() / 1000)
      });
      if (!result.uid || result.uid !== target.uid) throw new Error("Stripe reconciliation account link disagrees with the ledger.");
    },
    google_play: async (target, input) => {
      await reconcileGooglePlaySubscription({
        store,
        uid: target.uid,
        providerSubscriptionId: target.providerSubscriptionId,
        eventId: `reconcile:${input.runId}:${target.id}`,
        eventCreated: Math.floor(input.now.getTime() / 1000)
      });
    },
    apple: async (target, input) => {
      await reconcileAppleSubscription({
        store,
        uid: target.uid,
        providerSubscriptionId: target.providerSubscriptionId,
        eventId: `reconcile:${input.runId}:${target.id}`,
        eventCreated: Math.floor(input.now.getTime() / 1000)
      });
    }
  };
}

export async function runSubscriptionReconciliation(input: {
  db?: Firestore;
  store?: EntitlementStore;
  repository?: SubscriptionReconciliationRepository;
  handlers?: SubscriptionReconciliationHandlers;
  now?: Date;
  runId?: string;
}): Promise<SubscriptionReconciliationResult> {
  const now = input.now ?? new Date();
  const runId = input.runId ?? randomUUID();
  if (!input.repository && !input.db) throw new Error("Subscription reconciliation requires a Firestore repository.");
  const repository = input.repository ?? new FirestoreSubscriptionReconciliationRepository(input.db as Firestore);
  if (!await repository.acquireLease(runId, now)) {
    return { runId, state: "skipped", bootstrapped: 0, attempted: 0, succeeded: 0, failed: 0, reason: "lease_held" };
  }

  let began = false;
  try {
    await repository.beginRun(runId, now);
    began = true;
    const bootstrapped = await repository.bootstrap(now);
    const targets = await repository.due(now, MAX_TARGETS_PER_RUN);
    const store = input.store ?? (input.db ? new EntitlementStore(input.db) : undefined);
    if (!input.handlers && !store) throw new Error("Subscription reconciliation requires an entitlement store for provider handlers.");
    const handlers = input.handlers ?? defaultHandlers(store as EntitlementStore);
    let succeeded = 0;
    let failed = 0;
    for (let offset = 0; offset < targets.length; offset += PROVIDER_CONCURRENCY) {
      await Promise.all(targets.slice(offset, offset + PROVIDER_CONCURRENCY).map(async (target) => {
        try {
          await handlers[target.provider](target, { runId, now });
          await repository.markSucceeded(target, runId, now);
          succeeded += 1;
        } catch (error) {
          await repository.markFailed(target, runId, error, now);
          failed += 1;
        }
      }));
    }
    const result: SubscriptionReconciliationResult = {
      runId,
      state: failed ? "partial" : "complete",
      bootstrapped,
      attempted: targets.length,
      succeeded,
      failed
    };
    await repository.finishRun(runId, {
      state: result.state,
      bootstrapped,
      attempted: result.attempted,
      succeeded,
      failed
    }, now);
    return result;
  } catch (error) {
    if (began) await repository.failRun(runId, error, now);
    throw error;
  } finally {
    await repository.releaseLease(runId, new Date());
  }
}
