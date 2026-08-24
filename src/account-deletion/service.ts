import { randomUUID } from "node:crypto";
import type { Auth } from "firebase-admin/auth";
import { FieldValue, type Firestore, type Query, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";
import { HttpError } from "../http/auth.js";
import { stableDocumentId, sha256 } from "../infrastructure/ids.js";
import { EntitlementStore } from "../infrastructure/entitlement-store.js";
import { recordAdminAudit, type AdminActor } from "../admin/audit.js";
import type {
  LegacyPersonalDataErasureResult,
  LegacyPersonalDataSubject
} from "../legacy/personal-data-erasure.js";

export const ACCOUNT_DELETION_CONFIRMATION = "DELETE MY WONDERLANG ACCOUNT";
export const ACCOUNT_DELETION_RECOVERY_DAYS = 30;

export interface LegacyPersonalDataEraser {
  erase(subject: LegacyPersonalDataSubject): Promise<LegacyPersonalDataErasureResult>;
}

interface DeletionPreview {
  id: string;
  uid: string;
  state: "preview" | "processing" | "complete";
  confirmationPhrase: string;
  expiresAt: string;
  result?: Record<string, unknown>;
}

export class AccountDeletionService {
  constructor(
    private readonly db: Firestore,
    private readonly auth: Auth,
    private readonly storage?: Storage,
    private readonly legacyPersonalDataEraser?: LegacyPersonalDataEraser
  ) {}

  async preview(uid: string, now: Date): Promise<Record<string, unknown>> {
    const existing = await this.db.collection("accountDeletionRequests").doc(uid).get();
    if (existing.exists && existing.data()?.state === "scheduled") {
      throw new HttpError(409, "Account deletion is already scheduled. Contact support during the recovery window to cancel it.");
    }
    const id = randomUUID();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
    await this.db.collection("accountDeletionPreviews").doc(id).create({
      id,
      uid,
      state: "preview",
      confirmationPhrase: ACCOUNT_DELETION_CONFIRMATION,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    });
    return {
      previewId: id,
      confirmationPhrase: ACCOUNT_DELETION_CONFIRMATION,
      expiresAt: expiresAt.toISOString(),
      recoveryDays: ACCOUNT_DELETION_RECOVERY_DAYS,
      consequences: [
        "All WonderLang sessions are revoked and the account is disabled immediately.",
        "Support can cancel the request during the 30-day recovery window.",
        "After the window, cloud saves and account profile data are permanently deleted.",
        "A minimized, pseudonymous transaction ledger is retained for accounting, fraud prevention, refunds, and receipt-replay protection."
      ]
    };
  }

  async commit(input: { uid: string; previewId: string; confirmationPhrase: string; now: Date }): Promise<Record<string, unknown>> {
    const previewRef = this.db.collection("accountDeletionPreviews").doc(input.previewId);
    const requestRef = this.db.collection("accountDeletionRequests").doc(input.uid);
    const deleteAfter = new Date(input.now.getTime() + ACCOUNT_DELETION_RECOVERY_DAYS * 24 * 60 * 60 * 1000);
    const preview = await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(previewRef);
      if (!snapshot.exists) throw new HttpError(404, "Account-deletion preview not found.");
      const data = snapshot.data() as DeletionPreview;
      if (data.uid !== input.uid) throw new HttpError(403, "This deletion preview belongs to another account.");
      if (data.state === "complete" && data.result) return data;
      if (data.state !== "preview") throw new HttpError(409, "This deletion request is already processing.");
      if (Date.parse(data.expiresAt) <= input.now.getTime()) throw new HttpError(410, "The deletion preview expired. Review it again.");
      if (input.confirmationPhrase.trim() !== data.confirmationPhrase) throw new HttpError(400, `Type ${ACCOUNT_DELETION_CONFIRMATION} to confirm.`);
      const result = { state: "scheduled", requestedAt: input.now.toISOString(), deleteAfter: deleteAfter.toISOString(), recoveryDays: ACCOUNT_DELETION_RECOVERY_DAYS };
      transaction.set(requestRef, { uid: input.uid, ...result, previewId: input.previewId });
      transaction.update(previewRef, { state: "complete", completedAt: input.now.toISOString(), result });
      return { ...data, state: "complete" as const, result };
    });
    const result = preview.result as Record<string, unknown>;
    await this.auth.updateUser(input.uid, { disabled: true });
    await this.auth.revokeRefreshTokens(input.uid);
    const store = new EntitlementStore(this.db);
    await store.enqueue("delete_account_data", `account-deletion:${input.uid}`, { uid: input.uid }, input.now, deleteAfter);
    await this.db.collection("accountAudit").add({
      actorUid: input.uid,
      action: "account.deletion.request",
      summary: "Scheduled account deletion after recovery window",
      createdAt: input.now.toISOString(),
      deleteAfter: deleteAfter.toISOString()
    });
    return result;
  }

  async cancel(input: { actor: AdminActor; uid: string; reason: string; now: Date }): Promise<Record<string, unknown>> {
    if (input.reason.trim().length < 10) throw new HttpError(400, "A clear cancellation reason of at least ten characters is required.");
    const requestRef = this.db.collection("accountDeletionRequests").doc(input.uid);
    const outboxRef = this.db.collection("outbox").doc(stableDocumentId("delete_account_data", `account-deletion:${input.uid}`));
    await this.db.runTransaction(async (transaction) => {
      const [request, outbox] = await Promise.all([transaction.get(requestRef), transaction.get(outboxRef)]);
      if (!request.exists || request.data()?.state !== "scheduled") throw new HttpError(409, "No scheduled deletion request can be canceled.");
      if (Date.parse(String(request.data()?.deleteAfter)) <= input.now.getTime()) throw new HttpError(410, "The recovery window has ended.");
      transaction.update(requestRef, { state: "canceled", canceledAt: input.now.toISOString(), canceledBy: input.actor.uid, cancellationReason: input.reason.trim() });
      if (outbox.exists && outbox.data()?.state === "pending") transaction.update(outboxRef, { state: "canceled", canceledAt: input.now.toISOString() });
    });
    await this.auth.updateUser(input.uid, { disabled: false });
    await this.auth.revokeRefreshTokens(input.uid);
    await recordAdminAudit({
      db: this.db,
      actor: input.actor,
      action: "account.deletion.cancel",
      targetType: "user",
      targetId: input.uid,
      summary: "Canceled account deletion and re-enabled sign-in",
      metadata: { reason: input.reason.trim() },
      now: input.now
    });
    return { state: "canceled", uid: input.uid };
  }

  private async rewriteUid(query: Query, uid: string, replacement: string, now: Date, scrubMetadata = false): Promise<number> {
    const snapshot = await query.where("uid", "==", uid).get();
    let count = 0;
    for (let offset = 0; offset < snapshot.docs.length; offset += 400) {
      const batch = this.db.batch();
      for (const doc of snapshot.docs.slice(offset, offset + 400)) {
        batch.set(doc.ref, {
          uid: replacement,
          ...(scrubMetadata ? { metadata: { accountDeleted: true } } : {}),
          accountDeletedAt: now.toISOString()
        }, { merge: true });
        count += 1;
      }
      await batch.commit();
    }
    return count;
  }

  private async linkedLegacyOrders(uid: string): Promise<QueryDocumentSnapshot[]> {
    const snapshots = await Promise.all([
      this.db.collection("legacyOrders").where("firebaseUid", "==", uid).get(),
      this.db.collection("legacyOrders").where("claimedByUid", "==", uid).get()
    ]);
    const documents = new Map<string, QueryDocumentSnapshot>();
    for (const snapshot of snapshots) {
      for (const document of snapshot.docs) documents.set(document.ref.path, document);
    }
    return [...documents.values()];
  }

  private async linkedLegacyKeys(orders: QueryDocumentSnapshot[]): Promise<QueryDocumentSnapshot[]> {
    const keyDocuments = new Map<string, QueryDocumentSnapshot>();
    for (const order of orders) {
      const snapshot = await this.db.collection("legacyKeys").where("assignedOrderId", "==", order.id).get();
      for (const document of snapshot.docs) keyDocuments.set(document.ref.path, document);
    }
    return [...keyDocuments.values()];
  }

  private legacyPersonalDataSubject(orders: QueryDocumentSnapshot[], keys: QueryDocumentSnapshot[]): LegacyPersonalDataSubject {
    const emails = orders
      .map((order) => order.data().buyerEmail)
      .filter((email): email is string => typeof email === "string" && email.length > 0);
    const sheetAssignments = keys.map((key) => {
      const data = key.data();
      if (typeof data.sheetTab !== "string" || !Number.isSafeInteger(data.rowNumber) || data.rowNumber < 1) {
        throw new Error(`Legacy key ${key.id} has no valid Google Sheet assignment for personal-data erasure.`);
      }
      return { sheetTab: data.sheetTab, rowNumber: data.rowNumber as number };
    });
    return { emails, sheetAssignments };
  }

  private async scrubLegacyPurchaseData(
    orders: QueryDocumentSnapshot[],
    keys: QueryDocumentSnapshot[],
    deletedUid: string,
    now: Date
  ): Promise<{ orders: number; keys: number }> {
    for (let offset = 0; offset < orders.length; offset += 400) {
      const batch = this.db.batch();
      for (const order of orders.slice(offset, offset + 400)) {
        batch.set(order.ref, {
          buyerEmail: FieldValue.delete(),
          firebaseUid: deletedUid,
          claimedByUid: deletedUid,
          accountDeletedAt: now.toISOString()
        }, { merge: true });
      }
      await batch.commit();
    }

    for (let offset = 0; offset < keys.length; offset += 400) {
      const batch = this.db.batch();
      for (const key of keys.slice(offset, offset + 400)) {
        batch.set(key.ref, {
          assignedEmail: FieldValue.delete(),
          accountDeletedAt: now.toISOString()
        }, { merge: true });
      }
      await batch.commit();
    }
    return { orders: orders.length, keys: keys.length };
  }

  private async scrubAccountOutbox(uid: string, now: Date): Promise<number> {
    const snapshots = await Promise.all([
      this.db.collection("outbox").where("payload.uid", "==", uid).get(),
      this.db.collection("outbox").where("payload.firebaseUid", "==", uid).get(),
      this.db.collection("outbox").where("payload.subjectUidHash", "==", sha256(uid)).get()
    ]);
    const documents = new Map<string, QueryDocumentSnapshot>();
    for (const snapshot of snapshots) {
      for (const document of snapshot.docs) {
        const data = document.data() as { kind?: string; payload?: { uid?: string }; state?: string };
        // The worker still needs its own UID until purge returns. Completion
        // immediately redacts the payload in completeOutboxJob.
        if (data.kind === "delete_account_data" && data.payload?.uid === uid) continue;
        documents.set(document.ref.path, document);
      }
    }
    const jobs = [...documents.values()];
    for (let offset = 0; offset < jobs.length; offset += 400) {
      const batch = this.db.batch();
      for (const job of jobs.slice(offset, offset + 400)) {
        const state = String(job.data().state ?? "");
        batch.set(job.ref, {
          ...(state === "complete" || state === "canceled" ? {} : { state: "canceled", canceledAt: now.toISOString() }),
          payload: { redacted: true, redactedAt: now.toISOString() },
          lastError: FieldValue.delete(),
          workerId: FieldValue.delete(),
          leaseExpiresAt: FieldValue.delete()
        }, { merge: true });
      }
      await batch.commit();
    }
    return jobs.length;
  }

  private async deleteQuery(query: Query): Promise<number> {
    const snapshot = await query.get();
    let count = 0;
    for (let offset = 0; offset < snapshot.docs.length; offset += 400) {
      const batch = this.db.batch();
      for (const doc of snapshot.docs.slice(offset, offset + 400)) { batch.delete(doc.ref); count += 1; }
      await batch.commit();
    }
    return count;
  }

  async purge(uid: string, now: Date): Promise<Record<string, unknown>> {
    if (!this.storage) throw new Error("Account deletion storage is not configured.");
    const requestRef = this.db.collection("accountDeletionRequests").doc(uid);
    const request = await requestRef.get();
    if (!request.exists || request.data()?.state !== "scheduled") return { skipped: true, reason: "not_scheduled" };
    if (Date.parse(String(request.data()?.deleteAfter)) > now.getTime()) return { skipped: true, reason: "recovery_window_active" };
    const deletedUid = `deleted_${sha256(uid)}`;
    const user = await this.db.collection("users").doc(uid).get();
    const storeAccountToken = user.data()?.storeAccountToken as string | undefined;

    await Promise.all([
      this.storage.bucket().deleteFiles({ prefix: `cloud-saves/${uid}/`, force: true }),
      this.storage.bucket().deleteFiles({ prefix: `cloud-save-uploads/${uid}/`, force: true })
    ]);
    await this.db.recursiveDelete(this.db.collection("cloudSaves").doc(uid));
    const legacyOrders = await this.linkedLegacyOrders(uid);
    const legacyKeys = await this.linkedLegacyKeys(legacyOrders);
    const legacySubject = this.legacyPersonalDataSubject(legacyOrders, legacyKeys);
    let externalLegacyErasure: LegacyPersonalDataErasureResult = {
      sheetEmailCellsCleared: 0,
      mailerLiteSubscribersForgotten: 0
    };
    if (legacySubject.emails.length || legacySubject.sheetAssignments.length) {
      if (!this.legacyPersonalDataEraser) {
        throw new Error("Legacy external personal-data erasure is not configured.");
      }
      // External deletion is deliberately first. Both provider operations are
      // idempotent, so a later Firestore failure can safely retry without
      // losing the email/row coordinates needed to finish erasure.
      externalLegacyErasure = await this.legacyPersonalDataEraser.erase(legacySubject);
    }

    const deletedPrivateRows = await Promise.all([
      this.deleteQuery(this.db.collection("cloudSaveUploads").where("uid", "==", uid)),
      this.deleteQuery(this.db.collection("checkoutContexts").where("uid", "==", uid)),
      this.deleteQuery(this.db.collection("subscriptionContexts").where("uid", "==", uid)),
      this.deleteQuery(this.db.collection("pendingImports").where("claimedByUid", "==", uid)),
      this.deleteQuery(this.db.collection("accountDeletionPreviews").where("uid", "==", uid))
    ]);
    const [legacyPurchaseRows, scrubbedOutboxRows] = await Promise.all([
      this.scrubLegacyPurchaseData(legacyOrders, legacyKeys, deletedUid, now),
      this.scrubAccountOutbox(uid, now)
    ]);
    const pseudonymizedRows = await Promise.all([
      this.rewriteUid(this.db.collection("grants"), uid, deletedUid, now, true),
      this.rewriteUid(this.db.collection("providerTransactions"), uid, deletedUid, now),
      this.rewriteUid(this.db.collection("providerSubscriptions"), uid, deletedUid, now),
      this.rewriteUid(this.db.collection("providerCustomers"), uid, deletedUid, now)
    ]);
    const batch = this.db.batch();
    batch.delete(this.db.collection("users").doc(uid));
    batch.delete(this.db.collection("entitlements").doc(uid));
    batch.delete(this.db.collection("legacyDiscountClaims").doc(uid));
    if (storeAccountToken) batch.delete(this.db.collection("storeAccountTokens").doc(stableDocumentId("store-account", storeAccountToken)));
    const tombstoneRef = this.db.collection("accountDeletionTombstones").doc(sha256(uid));
    batch.set(tombstoneRef, { deletedUid, completedAt: now.toISOString(), retainedLedgerRows: pseudonymizedRows.reduce((sum, value) => sum + value, 0) });
    batch.delete(requestRef);
    await batch.commit();
    await this.auth.deleteUser(uid).catch((error) => {
      if ((error as { code?: string }).code !== "auth/user-not-found") throw error;
    });
    return {
      deleted: true,
      deletedPrivateRows: deletedPrivateRows.reduce((sum, value) => sum + value, 0),
      pseudonymizedLedgerRows: pseudonymizedRows.reduce((sum, value) => sum + value, 0),
      pseudonymizedLegacyOrders: legacyPurchaseRows.orders,
      scrubbedLegacyKeyAssignments: legacyPurchaseRows.keys,
      scrubbedOutboxRows,
      ...externalLegacyErasure
    };
  }
}
