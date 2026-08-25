import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { projectEntitlements } from "../src/domain/entitlement-projector.js";
import type { EffectiveEntitlements, LedgerGrant } from "../src/domain/model.js";
import {
  publicSecondPlatformRequest,
  secondPlatformEligibility,
  SecondPlatformRequestService,
  type SecondPlatformRequestRecord
} from "../src/premium/second-platform-request-service.js";

type Row = Record<string, unknown>;
type Collections = Map<string, Map<string, Row>>;

class FakeSnapshot {
  readonly ref: FakeDocumentReference;
  constructor(readonly id: string, readonly collectionName: string, private readonly rows: Map<string, Row>) {
    this.ref = new FakeDocumentReference(collectionName, id, rows);
  }
  get exists(): boolean { return this.rows.has(this.id); }
  data(): Row | undefined { return this.rows.get(this.id); }
}

class FakeDocumentReference {
  constructor(readonly collectionName: string, readonly id: string, private readonly rows: Map<string, Row>) {}
  async get(): Promise<FakeSnapshot> { return new FakeSnapshot(this.id, this.collectionName, this.rows); }
  async update(patch: Row): Promise<void> {
    const current = this.rows.get(this.id);
    if (!current) throw new Error("missing document");
    this.rows.set(this.id, { ...current, ...patch });
  }
}

class FakeQuery {
  private maximum = Number.POSITIVE_INFINITY;
  constructor(private readonly collectionName: string, private readonly rows: Map<string, Row>, private readonly field: string, private readonly value: unknown) {}
  limit(value: number): this { this.maximum = value; return this; }
  async get(): Promise<{ docs: FakeSnapshot[]; empty: boolean; size: number }> {
    const docs = [...this.rows.entries()]
      .filter(([, row]) => row[this.field] === this.value)
      .slice(0, this.maximum)
      .map(([id]) => new FakeSnapshot(id, this.collectionName, this.rows));
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

class FakeCollection {
  constructor(readonly name: string, private readonly rows: Map<string, Row>) {}
  doc(id: string): FakeDocumentReference { return new FakeDocumentReference(this.name, id, this.rows); }
  where(field: string, operator: string, value: unknown): FakeQuery {
    if (operator !== "==") throw new Error(`unsupported operator ${operator}`);
    return new FakeQuery(this.name, this.rows, field, value);
  }
}

function fakeFirestore(initial: Record<string, Record<string, Row>> = {}): { db: Firestore; collections: Collections } {
  const collections: Collections = new Map(Object.entries(initial).map(([name, rows]) => [name, new Map(Object.entries(rows))]));
  const rowsFor = (name: string) => {
    let rows = collections.get(name);
    if (!rows) { rows = new Map(); collections.set(name, rows); }
    return rows;
  };
  const set = (ref: FakeDocumentReference, data: Row, options?: { merge?: boolean }) => {
    const rows = rowsFor(ref.collectionName);
    rows.set(ref.id, options?.merge ? { ...(rows.get(ref.id) || {}), ...data } : { ...data });
  };
  const db = {
    collection: (name: string) => new FakeCollection(name, rowsFor(name)),
    runTransaction: async <T>(callback: (transaction: {
      get: (target: FakeDocumentReference | FakeQuery) => Promise<unknown>;
      set: (ref: FakeDocumentReference, data: Row, options?: { merge?: boolean }) => void;
      update: (ref: FakeDocumentReference, patch: Row) => void;
      create: (ref: FakeDocumentReference, data: Row) => void;
    }) => Promise<T>) => callback({
      get: (target) => target.get(),
      set,
      update: (ref, patch) => {
        const rows = rowsFor(ref.collectionName);
        const current = rows.get(ref.id);
        if (!current) throw new Error("missing document");
        rows.set(ref.id, { ...current, ...patch });
      },
      create: (ref, data) => {
        const rows = rowsFor(ref.collectionName);
        if (rows.has(ref.id)) throw new Error("document already exists");
        rows.set(ref.id, { ...data });
      }
    })
  } as unknown as Firestore;
  return { db, collections };
}

const now = new Date("2026-08-25T12:00:00.000Z");
const uid = "premium-user";

function premiumGrant(platform: "android" | "ios" = "android"): LedgerGrant {
  return {
    id: "premium-grant",
    uid,
    provider: "stripe",
    providerTransactionId: "pi_premium",
    product: "premium_lifetime_pass",
    state: "active",
    startsAt: "2026-08-20T00:00:00.000Z",
    metadata: { primaryMobilePlatform: platform }
  };
}

function premiumEntitlements(platform: "android" | "ios" = "android"): EffectiveEntitlements {
  return projectEntitlements(uid, [premiumGrant(platform)], now);
}

describe("Premium second-mobile-platform requests", () => {
  it("derives the other permanent platform only for an eligible Premium account", () => {
    expect(secondPlatformEligibility(premiumEntitlements("android"))).toEqual({ state: "eligible", sourcePlatform: "android", requestedPlatform: "ios" });
    expect(secondPlatformEligibility(premiumEntitlements("ios"))).toEqual({ state: "eligible", sourcePlatform: "ios", requestedPlatform: "android" });
    expect(secondPlatformEligibility(projectEntitlements(uid, [], now))).toEqual({ state: "not_premium" });
    expect(secondPlatformEligibility({ ...premiumEntitlements(), permanentMobilePlatforms: [] })).toEqual({ state: "missing_primary_platform" });
    const both = projectEntitlements(uid, [premiumGrant(), {
      id: "ios-grant",
      uid,
      provider: "admin",
      providerTransactionId: "second-ios",
      product: "mobile_polyglot_permanent",
      state: "active",
      startsAt: now.toISOString(),
      metadata: { mobilePlatform: "ios" }
    }], now);
    expect(secondPlatformEligibility(both)).toEqual({ state: "already_granted" });
  });

  it("never exposes administrator identity, audit reason, lease token, or grant ID to the customer", () => {
    const record: SecondPlatformRequestRecord = {
      uid,
      email: "premium@example.com",
      sourcePlatform: "android",
      requestedPlatform: "ios",
      state: "approving",
      revision: 2,
      submittedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      approvalToken: "private-lease-token",
      approvalLeaseUntil: new Date(now.getTime() + 60_000).toISOString(),
      approvalActorUid: "admin-uid",
      approvalActorEmail: "admin@example.com",
      decisionReason: "private support note",
      grantId: "private-grant-id"
    };
    const customer = publicSecondPlatformRequest(record);
    expect(customer).toMatchObject({ state: "approving", sourcePlatform: "android", requestedPlatform: "ios", revision: 2 });
    for (const privateField of ["uid", "email", "approvalToken", "approvalActorUid", "approvalActorEmail", "decisionReason", "grantId"]) {
      expect(customer).not.toHaveProperty(privateField);
    }
  });

  it("submits idempotently, permits cancellation only while pending, and revisions a resubmission", async () => {
    const { db } = fakeFirestore();
    const service = new SecondPlatformRequestService(db);
    const first = await service.submit({ uid, email: "premium@example.com", entitlements: premiumEntitlements(), now });
    const duplicate = await service.submit({ uid, email: "premium@example.com", entitlements: premiumEntitlements(), now: new Date(now.getTime() + 1_000) });
    expect(duplicate).toEqual(first);
    expect(first).toMatchObject({ state: "pending", revision: 1, sourcePlatform: "android", requestedPlatform: "ios" });

    const canceled = await service.cancel({ uid, now: new Date(now.getTime() + 2_000) });
    expect(canceled.state).toBe("canceled");
    expect(await service.cancel({ uid, now: new Date(now.getTime() + 3_000) })).toEqual(canceled);

    const resubmitted = await service.submit({ uid, email: "premium@example.com", entitlements: premiumEntitlements(), now: new Date(now.getTime() + 4_000) });
    expect(resubmitted).toMatchObject({ state: "pending", revision: 2 });
  });

  it("approves with one deterministic permanent grant and one immutable audit record", async () => {
    const grant = premiumGrant();
    const { db, collections } = fakeFirestore({ grants: { [grant.id]: grant as unknown as Row } });
    const service = new SecondPlatformRequestService(db);
    await service.submit({ uid, email: "premium@example.com", entitlements: premiumEntitlements(), now });
    const actor = { uid: "admin-1", email: "owner@wonderlang.net" };
    const reason = "Premium customer requested their included iOS access.";
    const approved = await service.approve({ actor, uid, reason, now: new Date(now.getTime() + 1_000) });
    expect(approved).toMatchObject({ state: "approved", sourcePlatform: "android", requestedPlatform: "ios", revision: 1 });

    const permanentGrants = [...(collections.get("grants")?.values() || [])].filter((row) => row.product === "mobile_polyglot_permanent");
    expect(permanentGrants).toHaveLength(1);
    expect(permanentGrants[0]).toMatchObject({
      uid,
      provider: "admin",
      providerTransactionId: `premium-second-platform:${uid}:ios`,
      state: "active",
      metadata: { mobilePlatform: "ios", premiumSecondPlatformRequest: true, requestRevision: 1, actorUid: actor.uid, reason }
    });
    const audits = [...(collections.get("adminAudit")?.values() || [])];
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorUid: actor.uid,
      actorEmail: actor.email,
      action: "second_platform_request.approve",
      targetType: "secondPlatformRequest",
      targetId: uid,
      metadata: { reason, requestedPlatform: "ios", revision: 1 }
    });

    const repeated = await service.approve({ actor, uid, reason, now: new Date(now.getTime() + 2_000) });
    expect(repeated).toEqual(approved);
    expect([...(collections.get("grants")?.values() || [])].filter((row) => row.product === "mobile_polyglot_permanent")).toHaveLength(1);
    expect(collections.get("adminAudit")?.size).toBe(1);
    expect(await service.listOpen()).toEqual([]);
  });

  it("declines without granting access and removes the request from the open queue", async () => {
    const { db, collections } = fakeFirestore();
    const service = new SecondPlatformRequestService(db);
    await service.submit({ uid, email: "premium@example.com", entitlements: premiumEntitlements(), now });
    expect(await service.listOpen()).toHaveLength(1);
    const declined = await service.decline({
      actor: { uid: "admin-1", email: "owner@wonderlang.net" },
      uid,
      reason: "The request could not be validated against the support record.",
      now: new Date(now.getTime() + 1_000)
    });
    expect(declined.state).toBe("declined");
    expect(await service.decline({
      actor: { uid: "admin-1", email: "owner@wonderlang.net" },
      uid,
      reason: "The request could not be validated against the support record.",
      now: new Date(now.getTime() + 2_000)
    })).toEqual(declined);
    expect(await service.listOpen()).toEqual([]);
    expect(collections.get("grants")?.size || 0).toBe(0);
    expect(collections.get("adminAudit")?.size).toBe(1);
    expect([...(collections.get("adminAudit")?.values() || [])][0]).toMatchObject({ action: "second_platform_request.decline" });
  });
});
