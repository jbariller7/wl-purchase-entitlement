import { randomUUID } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { AdminActor } from "../admin/audit.js";
import type { EffectiveEntitlements } from "../domain/model.js";
import { HttpError } from "../http/auth.js";
import { EntitlementStore } from "../infrastructure/entitlement-store.js";
import { stableDocumentId } from "../infrastructure/ids.js";

export type MobilePlatform = "android" | "ios";
export type SecondPlatformRequestState = "pending" | "approving" | "approved" | "declined" | "canceled";

export interface SecondPlatformRequestRecord {
  uid: string;
  email: string;
  sourcePlatform: MobilePlatform;
  requestedPlatform: MobilePlatform;
  state: SecondPlatformRequestState;
  revision: number;
  submittedAt: string;
  updatedAt: string;
  approvalToken?: string;
  approvalLeaseUntil?: string;
  approvalActorUid?: string;
  approvalActorEmail?: string;
  decisionAt?: string;
  decisionActorUid?: string;
  decisionActorEmail?: string;
  decisionReason?: string;
  grantId?: string;
}

export interface PublicSecondPlatformRequest {
  state: SecondPlatformRequestState;
  sourcePlatform: MobilePlatform;
  requestedPlatform: MobilePlatform;
  revision: number;
  submittedAt: string;
  updatedAt: string;
  approvalLeaseUntil: string | null;
  decisionAt: string | null;
}

export interface AdminSecondPlatformRequest extends PublicSecondPlatformRequest {
  uid: string;
  email: string;
}

export type SecondPlatformEligibility =
  | { state: "eligible"; sourcePlatform: MobilePlatform; requestedPlatform: MobilePlatform }
  | { state: "already_granted" }
  | { state: "not_premium" }
  | { state: "missing_primary_platform" };

const APPROVAL_LEASE_MS = 5 * 60 * 1000;

export function secondPlatformEligibility(entitlements: EffectiveEntitlements): SecondPlatformEligibility {
  if (!entitlements.premiumLifetime || !entitlements.secondMobilePlatformEligible) return { state: "not_premium" };
  const permanent = [...new Set(entitlements.permanentMobilePlatforms)];
  if (permanent.length >= 2) return { state: "already_granted" };
  const sourcePlatform = permanent[0];
  if (!sourcePlatform) return { state: "missing_primary_platform" };
  return {
    state: "eligible",
    sourcePlatform,
    requestedPlatform: sourcePlatform === "android" ? "ios" : "android"
  };
}

export function publicSecondPlatformRequest(record: SecondPlatformRequestRecord): PublicSecondPlatformRequest {
  return {
    state: record.state,
    sourcePlatform: record.sourcePlatform,
    requestedPlatform: record.requestedPlatform,
    revision: record.revision,
    submittedAt: record.submittedAt,
    updatedAt: record.updatedAt,
    approvalLeaseUntil: record.approvalLeaseUntil ?? null,
    decisionAt: record.decisionAt ?? null
  };
}

function assertEligible(entitlements: EffectiveEntitlements): Extract<SecondPlatformEligibility, { state: "eligible" }> {
  const eligibility = secondPlatformEligibility(entitlements);
  if (eligibility.state === "already_granted") throw new HttpError(409, "Both permanent mobile platforms are already granted.");
  if (eligibility.state === "missing_primary_platform") throw new HttpError(409, "The primary Premium mobile platform must be resolved before requesting another platform.");
  if (eligibility.state !== "eligible") throw new HttpError(403, "Premium Lifetime is required to request the other mobile platform.");
  return eligibility;
}

function requestData(snapshot: FirebaseFirestore.DocumentSnapshot): SecondPlatformRequestRecord | undefined {
  return snapshot.exists ? snapshot.data() as SecondPlatformRequestRecord : undefined;
}

function auditRow(input: {
  id: string;
  actor: AdminActor;
  action: string;
  uid: string;
  summary: string;
  reason: string;
  requestedPlatform: MobilePlatform;
  revision: number;
  now: Date;
}) {
  return {
    id: input.id,
    actorUid: input.actor.uid,
    actorEmail: input.actor.email,
    action: input.action,
    targetType: "secondPlatformRequest",
    targetId: input.uid,
    summary: input.summary,
    metadata: {
      uid: input.uid,
      reason: input.reason,
      requestedPlatform: input.requestedPlatform,
      revision: input.revision
    },
    createdAt: input.now.toISOString()
  };
}

export class SecondPlatformRequestService {
  private readonly store: EntitlementStore;

  constructor(private readonly db: Firestore) {
    this.store = new EntitlementStore(db);
  }

  private ref(uid: string) {
    return this.db.collection("secondPlatformRequests").doc(uid);
  }

  async get(uid: string): Promise<PublicSecondPlatformRequest | null> {
    const snapshot = await this.ref(uid).get();
    const record = requestData(snapshot);
    return record ? publicSecondPlatformRequest(record) : null;
  }

  async submit(input: {
    uid: string;
    email: string;
    entitlements: EffectiveEntitlements;
    now: Date;
  }): Promise<PublicSecondPlatformRequest> {
    const eligibility = assertEligible(input.entitlements);
    const ref = this.ref(input.uid);
    const result = await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const current = requestData(snapshot);
      if (current && (current.state === "pending" || current.state === "approving")) {
        if (current.requestedPlatform !== eligibility.requestedPlatform) {
          throw new HttpError(409, "An existing second-platform request no longer matches this account. Contact support.");
        }
        return current;
      }
      const timestamp = input.now.toISOString();
      const next: SecondPlatformRequestRecord = {
        uid: input.uid,
        email: input.email,
        sourcePlatform: eligibility.sourcePlatform,
        requestedPlatform: eligibility.requestedPlatform,
        state: "pending",
        revision: (current?.revision ?? 0) + 1,
        submittedAt: timestamp,
        updatedAt: timestamp
      };
      transaction.set(ref, next);
      return next;
    });
    return publicSecondPlatformRequest(result);
  }

  async cancel(input: { uid: string; now: Date }): Promise<PublicSecondPlatformRequest> {
    const ref = this.ref(input.uid);
    const result = await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const current = requestData(snapshot);
      if (!current) throw new HttpError(404, "No second-platform request exists.");
      if (current.state === "canceled") return current;
      if (current.state !== "pending") throw new HttpError(409, "Only a pending second-platform request can be canceled.");
      const next: SecondPlatformRequestRecord = { ...current, state: "canceled", updatedAt: input.now.toISOString(), decisionAt: input.now.toISOString() };
      transaction.set(ref, next);
      return next;
    });
    return publicSecondPlatformRequest(result);
  }

  async listOpen(limit = 100): Promise<AdminSecondPlatformRequest[]> {
    const collection = this.db.collection("secondPlatformRequests");
    const [pending, approving] = await Promise.all([
      collection.where("state", "==", "pending").limit(limit).get(),
      collection.where("state", "==", "approving").limit(limit).get()
    ]);
    return [...new Map([...pending.docs, ...approving.docs].map((doc) => [doc.id, doc])).values()]
      .map((doc) => doc.data() as SecondPlatformRequestRecord)
      .sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt))
      .slice(0, limit)
      .map((record) => ({ uid: record.uid, email: record.email, ...publicSecondPlatformRequest(record) }));
  }

  private async claimApproval(input: { actor: AdminActor; uid: string; reason: string; now: Date }): Promise<{ record: SecondPlatformRequestRecord; approvalToken: string | null }> {
    const ref = this.ref(input.uid);
    const approvalToken = randomUUID();
    const result = await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const current = requestData(snapshot);
      if (!current) throw new HttpError(404, "Second-platform request not found.");
      if (current.state === "approved") return current;
      const staleApproval = current.state === "approving" && Date.parse(current.approvalLeaseUntil ?? "") <= input.now.getTime();
      if (current.state !== "pending" && !staleApproval) throw new HttpError(409, "This second-platform request is no longer awaiting approval.");
      const next: SecondPlatformRequestRecord = {
        ...current,
        state: "approving",
        approvalToken,
        approvalLeaseUntil: new Date(input.now.getTime() + APPROVAL_LEASE_MS).toISOString(),
        approvalActorUid: input.actor.uid,
        approvalActorEmail: input.actor.email,
        decisionReason: input.reason,
        updatedAt: input.now.toISOString()
      };
      transaction.set(ref, next);
      return next;
    });
    return { record: result, approvalToken: result.state === "approved" ? null : approvalToken };
  }

  private async releaseApproval(uid: string, approvalToken: string, now: Date): Promise<void> {
    const ref = this.ref(uid);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const current = requestData(snapshot);
      if (!current || current.state !== "approving" || current.approvalToken !== approvalToken) return;
      transaction.update(ref, {
        state: "pending",
        approvalToken: FieldValue.delete(),
        approvalLeaseUntil: FieldValue.delete(),
        approvalActorUid: FieldValue.delete(),
        approvalActorEmail: FieldValue.delete(),
        decisionReason: FieldValue.delete(),
        updatedAt: now.toISOString()
      });
    }).catch(() => undefined);
  }

  async approve(input: { actor: AdminActor; uid: string; reason: string; now: Date }): Promise<PublicSecondPlatformRequest> {
    if (input.reason.trim().length < 10) throw new HttpError(400, "A clear audit reason of at least ten characters is required.");
    const claim = await this.claimApproval({ ...input, reason: input.reason.trim() });
    if (!claim.approvalToken) return publicSecondPlatformRequest(claim.record);
    try {
      const entitlements = await this.store.effectiveEntitlements(input.uid, input.now);
      const alreadyGranted = entitlements.permanentMobilePlatforms.includes(claim.record.requestedPlatform);
      let grantId: string | undefined;
      if (!alreadyGranted) {
        const eligibility = assertEligible(entitlements);
        if (eligibility.requestedPlatform !== claim.record.requestedPlatform || eligibility.sourcePlatform !== claim.record.sourcePlatform) {
          throw new HttpError(409, "The requested platform no longer matches this account's Premium access.");
        }
        const transactionId = `premium-second-platform:${input.uid}:${claim.record.requestedPlatform}`;
        await this.store.upsertGrant({
          id: "",
          uid: input.uid,
          provider: "admin",
          providerTransactionId: transactionId,
          product: "mobile_polyglot_permanent",
          state: "active",
          startsAt: input.now.toISOString(),
          metadata: {
            mobilePlatform: claim.record.requestedPlatform,
            premiumSecondPlatformRequest: true,
            requestRevision: claim.record.revision,
            actorUid: input.actor.uid,
            reason: input.reason.trim()
          }
        }, { id: `second-platform-approval:${input.uid}:${claim.record.revision}`, created: Math.floor(input.now.getTime() / 1000) });
        grantId = this.store.grantId({
          provider: "admin",
          providerTransactionId: transactionId,
          product: "mobile_polyglot_permanent"
        });
      }
      const requestRef = this.ref(input.uid);
      const auditId = stableDocumentId("admin-audit", `second-platform:${input.uid}:${claim.record.revision}:approve`);
      const finalized = await this.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(requestRef);
        const current = requestData(snapshot);
        if (current?.state === "approved" && current.revision === claim.record.revision) return current;
        if (!current || current.state !== "approving" || current.approvalToken !== claim.approvalToken || current.revision !== claim.record.revision) {
          throw new HttpError(409, "The second-platform request changed while it was being approved.");
        }
        const timestamp = input.now.toISOString();
        const next: SecondPlatformRequestRecord = {
          ...current,
          state: "approved",
          ...(grantId ? { grantId } : {}),
          decisionAt: timestamp,
          decisionActorUid: input.actor.uid,
          decisionActorEmail: input.actor.email,
          decisionReason: input.reason.trim(),
          updatedAt: timestamp
        };
        delete next.approvalToken;
        delete next.approvalLeaseUntil;
        delete next.approvalActorUid;
        delete next.approvalActorEmail;
        transaction.set(requestRef, next);
        transaction.create(this.db.collection("adminAudit").doc(auditId), auditRow({
          id: auditId,
          actor: input.actor,
          action: "second_platform_request.approve",
          uid: input.uid,
          summary: `Approved permanent ${current.requestedPlatform} access for Premium Lifetime`,
          reason: input.reason.trim(),
          requestedPlatform: current.requestedPlatform,
          revision: current.revision,
          now: input.now
        }));
        return next;
      });
      return publicSecondPlatformRequest(finalized);
    } catch (error) {
      await this.releaseApproval(input.uid, claim.approvalToken, input.now);
      throw error;
    }
  }

  async decline(input: { actor: AdminActor; uid: string; reason: string; now: Date }): Promise<PublicSecondPlatformRequest> {
    if (input.reason.trim().length < 10) throw new HttpError(400, "A clear audit reason of at least ten characters is required.");
    const requestRef = this.ref(input.uid);
    const result = await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(requestRef);
      const current = requestData(snapshot);
      if (!current) throw new HttpError(404, "Second-platform request not found.");
      if (current.state === "declined") return current;
      const staleApproval = current.state === "approving" && Date.parse(current.approvalLeaseUntil ?? "") <= input.now.getTime();
      if (current.state !== "pending" && !staleApproval) throw new HttpError(409, "This second-platform request is no longer awaiting a decision.");
      const timestamp = input.now.toISOString();
      const next: SecondPlatformRequestRecord = {
        ...current,
        state: "declined",
        decisionAt: timestamp,
        decisionActorUid: input.actor.uid,
        decisionActorEmail: input.actor.email,
        decisionReason: input.reason.trim(),
        updatedAt: timestamp
      };
      delete next.approvalToken;
      delete next.approvalLeaseUntil;
      delete next.approvalActorUid;
      delete next.approvalActorEmail;
      const auditId = stableDocumentId("admin-audit", `second-platform:${input.uid}:${current.revision}:decline`);
      transaction.set(requestRef, next);
      transaction.create(this.db.collection("adminAudit").doc(auditId), auditRow({
        id: auditId,
        actor: input.actor,
        action: "second_platform_request.decline",
        uid: input.uid,
        summary: `Declined permanent ${current.requestedPlatform} access request`,
        reason: input.reason.trim(),
        requestedPlatform: current.requestedPlatform,
        revision: current.revision,
        now: input.now
      }));
      return next;
    });
    return publicSecondPlatformRequest(result);
  }
}
