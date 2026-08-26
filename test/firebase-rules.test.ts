import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment
} from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { deleteObject, getBytes, listAll, ref, uploadBytes } from "firebase/storage";
import { deleteApp, initializeApp } from "firebase-admin/app";
import type { Auth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccountDeletionService } from "../src/account-deletion/service.js";
import { AdminOperationsService } from "../src/admin/operations-service.js";
import { CloudSaveProfileService, cloudProfileStagingObjectPath } from "../src/cloud-save/profile-service.js";
import { EntitlementStore } from "../src/infrastructure/entitlement-store.js";
import { sha256, stableDocumentId } from "../src/infrastructure/ids.js";
import {
  FirestoreSubscriptionReconciliationRepository,
  type SubscriptionReconciliationTarget
} from "../src/reconciliation/subscription-reconciler.js";

const projectId = "demo-wonderlang-entitlements";
const bucketUrl = "gs://" + projectId + ".appspot.com";
const emulatorsAvailable = Boolean(
  process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST
);

let environment: RulesTestEnvironment;

function firestore(context: RulesTestContext) {
  return context.firestore();
}

function storage(context: RulesTestContext) {
  return context.storage(bucketUrl);
}

describe.skipIf(!emulatorsAvailable)("deny-by-default Firebase client rules", () => {
  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId,
      firestore: {
        rules: readFileSync(resolve("firestore.rules"), "utf8")
      },
      storage: {
        rules: readFileSync(resolve("storage.rules"), "utf8")
      }
    });

    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(firestore(context), "entitlementGrants", "seed"), {
        uid: "player-1",
        product: "premium_lifetime_pass"
      });
      await uploadBytes(
        ref(storage(context), "cloud-save-profiles/player-1/profiles/default/revisions/current.json"),
        new TextEncoder().encode("seed-save")
      );
    });
  }, 30_000);

  afterAll(async () => {
    if (!environment) return;
    await environment.clearFirestore();
    await environment.clearStorage();
    await environment.cleanup();
  }, 30_000);

  const identities = [
    {
      label: "unauthenticated client",
      context: () => environment.unauthenticatedContext()
    },
    {
      label: "authenticated player",
      context: () => environment.authenticatedContext("player-1", { email_verified: true })
    },
    {
      label: "client presenting an admin claim",
      context: () => environment.authenticatedContext("forged-admin", {
        admin: true,
        email_verified: true
      })
    }
  ];

  for (const identity of identities) {
    it("denies every Firestore operation to an " + identity.label, async () => {
      const database = firestore(identity.context());
      await assertFails(getDoc(doc(database, "entitlementGrants", "seed")));
      await assertFails(getDocs(collection(database, "entitlementGrants")));
      await assertFails(setDoc(doc(database, "entitlementGrants", "new"), { uid: "attacker" }));
      await assertFails(deleteDoc(doc(database, "entitlementGrants", "seed")));
    });

    it("denies every Storage operation to an " + identity.label, async () => {
      const clientStorage = storage(identity.context());
      const object = ref(clientStorage, "cloud-save-profiles/player-1/profiles/default/revisions/current.json");
      await assertFails(getBytes(object));
      await assertFails(listAll(ref(clientStorage, "cloud-save-profiles/player-1")));
      await assertFails(uploadBytes(
        ref(clientStorage, "cloud-save-profiles/player-1/profiles/default/revisions/attacker.json"),
        new TextEncoder().encode("attacker-save")
      ));
      await assertFails(deleteObject(object));
    });
  }

  it("uses the expected isolated emulator project", () => {
    expect(environment.projectId).toBe(projectId);
  });

  it("stores only a provider payload digest and redacts completed outbox payloads", async () => {
    const app = initializeApp({ projectId }, `retention-${Date.now()}`);
    const database = getAdminFirestore(app);
    const store = new EntitlementStore(database);
    const now = new Date("2026-08-24T12:00:00.000Z");
    try {
      await store.beginProviderEvent({
        provider: "stripe",
        providerEventId: "evt_retention_test",
        eventType: "checkout.session.completed",
        eventCreated: 1_787_572_800,
        payloadSha256: sha256("provider-payload-with-buyer@example.com"),
        now
      });
      const providerEvent = await database.collection("providerEvents")
        .doc(stableDocumentId("stripe", "evt_retention_test"))
        .get();
      expect(providerEvent.data()?.payloadSha256).toHaveLength(64);
      expect(providerEvent.data()).not.toHaveProperty("payload");

      await store.enqueue("meta_conversion", "meta:retention-test", {
        emailSha256: sha256("buyer@example.com"),
        ipAddress: "192.0.2.2"
      }, now);
      const outboxId = stableDocumentId("meta_conversion", "meta:retention-test");
      await store.completeOutboxJob(outboxId, new Date("2026-08-24T12:01:00.000Z"), { delivered: true });
      const outbox = await database.collection("outbox").doc(outboxId).get();
      expect(outbox.data()).toMatchObject({
        state: "complete",
        payload: { redacted: true },
        result: { delivered: true }
      });
      expect(JSON.stringify(outbox.data())).not.toContain("192.0.2.2");
    } finally {
      await deleteApp(app);
    }
  });

  it("schedules active subscriptions and stops revoked subscriptions from reconciliation", async () => {
    const app = initializeApp({ projectId }, `reconciliation-schedule-${Date.now()}`);
    const database = getAdminFirestore(app);
    const store = new EntitlementStore(database);
    const eventCreated = Math.floor(Date.now() / 1000);
    const grant = {
      id: "",
      uid: "subscriber-schedule-test",
      provider: "stripe" as const,
      providerTransactionId: "sub_schedule_test",
      providerSubscriptionId: "sub_schedule_test",
      product: "mobile_full_monthly" as const,
      state: "active" as const,
      startsAt: new Date(eventCreated * 1000).toISOString()
    };
    const subscriptionRef = database.collection("providerSubscriptions").doc(
      stableDocumentId("stripe", "sub_schedule_test")
    );
    try {
      await store.upsertGrant(grant, { id: "active", created: eventCreated });
      expect((await subscriptionRef.get()).data()).toMatchObject({
        product: "mobile_full_monthly",
        state: "active"
      });
      expect(typeof (await subscriptionRef.get()).data()?.nextReconciliationAt).toBe("string");

      await store.upsertGrant({ ...grant, state: "expired", endsAt: new Date().toISOString() }, {
        id: "expired",
        created: eventCreated + 1
      });
      const expired = (await subscriptionRef.get()).data();
      expect(expired?.state).toBe("expired");
      expect(Date.parse(String(expired?.reconcileUntil))).toBeGreaterThan(Date.now());
      expect(typeof expired?.nextReconciliationAt).toBe("string");

      await store.upsertGrant({ ...grant, state: "revoked", endsAt: new Date().toISOString() }, {
        id: "revoked",
        created: eventCreated + 2
      });
      expect((await subscriptionRef.get()).data()).toMatchObject({
        state: "revoked",
        nextReconciliationAt: null,
        reconcileUntil: null
      });
    } finally {
      await deleteApp(app);
    }
  });

  it("atomically prevents one provider purchase from being claimed by two accounts", async () => {
    const app = initializeApp({ projectId }, `provider-ownership-${Date.now()}`);
    const database = getAdminFirestore(app);
    const store = new EntitlementStore(database);
    const purchase = {
      id: "",
      provider: "apple" as const,
      providerTransactionId: "apple-original-purchase-ownership-test",
      product: "mobile_polyglot_permanent" as const,
      state: "active" as const,
      startsAt: "2026-08-25T10:00:00.000Z"
    };
    try {
      await store.upsertGrant({ ...purchase, uid: "first-player" }, {
        id: "first-claim",
        created: 1_787_654_321
      });
      await expect(store.upsertGrant({ ...purchase, uid: "second-player" }, {
        id: "restored-claim",
        created: 1_787_654_322
      })).rejects.toThrow(/already linked to another account/i);
      expect(await store.uidForProviderTransaction("apple", purchase.providerTransactionId)).toBe("first-player");
      expect((await store.grantsForUid("second-player"))).toHaveLength(0);
    } finally {
      await deleteApp(app);
    }
  });

  it("keeps a later Apple refund over a stale receipt replay signed in the same second", async () => {
    const app = initializeApp({ projectId }, `provider-chronology-${Date.now()}`);
    const database = getAdminFirestore(app);
    const store = new EntitlementStore(database);
    const purchase = {
      id: "",
      uid: "refund-owner",
      provider: "apple" as const,
      providerTransactionId: "apple-original-refund-chronology-test",
      product: "mobile_polyglot_permanent" as const,
      startsAt: "2026-08-25T10:00:00.000Z"
    };
    try {
      await store.upsertGrant({ ...purchase, state: "active" }, {
        id: "initial-purchase",
        created: 1_787_654_320.100
      });
      await store.upsertGrant({
        ...purchase,
        state: "refunded",
        endsAt: "2026-08-25T10:05:00.900Z",
        refundedAt: "2026-08-25T10:05:00.900Z"
      }, {
        id: "refund-notification",
        created: 1_787_654_321.900
      });
      await expect(store.upsertGrant({ ...purchase, state: "active" }, {
        id: "stale-client-replay",
        created: 1_787_654_321.100
      })).resolves.toBe(false);
      expect(await store.getGrant("apple", purchase.providerTransactionId, purchase.product)).toMatchObject({
        uid: "refund-owner",
        state: "refunded",
        sourceEventId: "refund-notification",
        sourceEventCreated: 1_787_654_321.900
      });
    } finally {
      await deleteApp(app);
    }
  });

  it("cannot re-enable reconciliation after an account-deletion race", async () => {
    const app = initializeApp({ projectId }, `reconciliation-deletion-race-${Date.now()}`);
    const database = getAdminFirestore(app);
    const id = stableDocumentId("stripe", "sub_deleted_race");
    const ref = database.collection("providerSubscriptions").doc(id);
    const target: SubscriptionReconciliationTarget = {
      id,
      provider: "stripe",
      providerSubscriptionId: "sub_deleted_race",
      uid: "original-user",
      state: "active"
    };
    const repository = new FirestoreSubscriptionReconciliationRepository(database);
    try {
      await ref.set({
        uid: "deleted_uid_hash",
        state: "active",
        reconciliationDisabledReason: "account_deleted",
        nextReconciliationAt: null
      });
      await database.collection("grants").doc("deleted-race-grant").set({
        uid: "deleted_uid_hash",
        provider: "stripe",
        providerSubscriptionId: "sub_deleted_race",
        product: "mobile_full_monthly",
        state: "active",
        metadata: { accountDeleted: true }
      });
      await expect(repository.bootstrap(new Date())).resolves.toBe(0);
      expect((await ref.get()).data()?.nextReconciliationAt).toBeNull();
      await new EntitlementStore(database).upsertGrant({
        id: "",
        uid: "deleted_uid_hash",
        provider: "stripe",
        providerTransactionId: "sub_deleted_race",
        providerSubscriptionId: "sub_deleted_race",
        product: "mobile_full_monthly",
        state: "active",
        startsAt: new Date().toISOString()
      }, { id: "late-webhook", created: Math.floor(Date.now() / 1000) });
      expect((await ref.get()).data()).toMatchObject({
        nextReconciliationAt: null,
        reconcileUntil: null,
        reconciliationDisabledReason: "account_deleted"
      });
      await repository.markFailed(target, "run-after-delete", new Error("late provider result"), new Date());
      expect((await ref.get()).data()).toMatchObject({
        nextReconciliationAt: null,
        lastReconciliationState: "disabled",
        lastReconciliationError: null
      });
      await ref.update({ nextReconciliationAt: new Date().toISOString() });
      await repository.markSucceeded(target, "run-after-delete", new Date());
      expect((await ref.get()).data()).toMatchObject({
        nextReconciliationAt: null,
        lastReconciliationState: "disabled"
      });
    } finally {
      await deleteApp(app);
    }
  });

  it("retains exactly four immutable save generations and drains the pruning queue", async () => {
    const app = initializeApp({ projectId }, `cloud-save-retention-${Date.now()}`);
    const database = getAdminFirestore(app);
    const uid = "cloud-retention-user";
    const store = new EntitlementStore(database);
    const objects = new Map<string, Buffer>();
    const fakeStorage = {
      bucket: () => ({
        file: (path: string) => ({
          getSignedUrl: async () => [`https://signed.invalid/${encodeURIComponent(path)}`],
          exists: async () => [objects.has(path)],
          download: async () => {
            const value = objects.get(path);
            if (!value) throw new Error("missing object");
            return [value];
          },
          save: async (contents: Buffer) => {
            if (objects.has(path)) {
              const error = new Error("precondition failed") as Error & { code: number };
              error.code = 412;
              throw error;
            }
            objects.set(path, Buffer.from(contents));
          },
          delete: async () => { objects.delete(path); }
        })
      })
    } as unknown as Storage;
    const service = new CloudSaveProfileService(database, fakeStorage, store);
    const uploadedIds: string[] = [];
    let baseRevision: string | null = null;
    let finalManifest: Awaited<ReturnType<CloudSaveProfileService["finalizeUpload"]>> | undefined;

    try {
      await store.upsertGrant({
        id: "",
        uid,
        provider: "admin",
        providerTransactionId: "cloud-retention-grant",
        product: "premium_lifetime_pass",
        state: "active",
        startsAt: "2026-08-25T08:00:00.000Z",
        metadata: { primaryMobilePlatform: "android" }
      }, { id: "grant", created: 1_777_000_000 });

      await service.list(uid, new Date("2026-08-25T09:59:00.000Z"));

      for (let index = 0; index < 5; index += 1) {
        const contents = Buffer.from(JSON.stringify({
          magic: "WL_CLOUD_PROFILE",
          version: 1,
          profileId: "default",
          files: { global: "[]", file1: JSON.stringify({ index, payload: `save-${index}` }) }
        }));
        const at = new Date(Date.parse("2026-08-25T10:00:00.000Z") + index * 1000);
        const prepared = await service.prepareUpload(uid, "default", {
          byteLength: contents.byteLength,
          sha256: sha256(contents),
          baseRevision
        }, at);
        uploadedIds.push(prepared.uploadId);
        objects.set(cloudProfileStagingObjectPath(uid, prepared.uploadId), contents);
        finalManifest = await service.finalizeUpload(uid, "default", prepared.uploadId, at);
        baseRevision = finalManifest.currentRevision;
      }

      const savedProfile = await database.collection("cloudSaves").doc(uid).collection("profiles").doc("default").get();
      expect(savedProfile.data()?.previousRevisions).toHaveLength(3);
      const immutable = [...objects.keys()].filter((path) => path.startsWith(`cloud-save-profiles/${uid}/`));
      expect(immutable).toHaveLength(4);
      expect([...objects.keys()].filter((path) => path.startsWith(`cloud-save-profile-uploads/${uid}/`))).toHaveLength(0);
      expect(immutable.some((path) => path.includes(uploadedIds[0]!))).toBe(false);
      expect(immutable.some((path) => path.includes(uploadedIds[4]!))).toBe(true);
      expect((await database.collection("cloudSaveCleanupJobs").where("uid", "==", uid).get()).empty).toBe(true);
    } finally {
      await deleteApp(app);
    }
  });

  it("lets an administrator audit and requeue a terminal cloud-save cleanup failure", async () => {
    const app = initializeApp({ projectId }, `cloud-save-cleanup-retry-${Date.now()}`);
    const database = getAdminFirestore(app);
    const jobId = "4acb303f-18d2-4b98-b665-058c332271df";
    const ref = database.collection("cloudSaveCleanupJobs").doc(jobId);
    try {
      await ref.set({
        state: "failed",
        uid: "retry-user",
        objectPaths: [`cloud-save-profiles/retry-user/profiles/default/revisions/${jobId}.json`],
        createdAt: "2026-08-25T09:00:00.000Z",
        attemptCount: 10,
        lastError: "Cloud Storage revision deletion failed."
      });
      const now = new Date("2026-08-25T12:00:00.000Z");
      await new AdminOperationsService(database, {} as Auth).retryCloudSaveCleanup({
        actor: { uid: "admin-user", email: "owner@wonderlang.net" },
        jobId,
        reason: "Retry after correcting the staging bucket IAM role.",
        now
      });
      expect((await ref.get()).data()).toMatchObject({
        state: "pending",
        attemptCount: 0,
        notBefore: now.toISOString(),
        manuallyRetriedAt: now.toISOString()
      });
      expect((await ref.get()).data()).not.toHaveProperty("lastError");
      const audit = await database.collection("adminAudit").where("targetId", "==", jobId).get();
      expect(audit.docs.some((row) => row.data().action === "cloud_save_cleanup.retry")).toBe(true);
    } finally {
      await deleteApp(app);
    }
  });

  it("pseudonymizes linked purchase records and cancels personal outbox work on final account deletion", async () => {
    const app = initializeApp({ projectId }, `account-deletion-${Date.now()}`);
    const database = getAdminFirestore(app);
    const uid = "delete-me";
    const deletedUid = `deleted_${sha256(uid)}`;
    const deletedPrefixes: string[] = [];
    const deletedAuthUsers: string[] = [];
    const erasedLegacySubjects: Array<{ emails: string[]; sheetAssignments: Array<{ sheetTab: string; rowNumber: number }> }> = [];
    const auth = {
      deleteUser: async (candidate: string) => { deletedAuthUsers.push(candidate); }
    } as unknown as Auth;
    const adminStorage = {
      bucket: () => ({
        deleteFiles: async ({ prefix }: { prefix: string }) => { deletedPrefixes.push(prefix); }
      })
    } as unknown as Storage;

    try {
      await Promise.all([
        database.collection("accountDeletionRequests").doc(uid).set({
          uid,
          state: "scheduled",
          deleteAfter: "2026-01-01T00:00:00.000Z"
        }),
        database.collection("users").doc(uid).set({ storeAccountToken: "store-token" }),
        database.collection("accountSecurity").doc(uid).set({
          deviceSessionGeneration: 3,
          sessionsRevokedAuthTime: 1_777_000_000
        }),
        database.collection("entitlements").doc(uid).set({ uid }),
        database.collection("grants").doc("grant-delete-me").set({ uid, metadata: { email: "buyer@example.com" } }),
        database.collection("providerTransactions").doc("transaction-delete-me").set({ uid }),
        database.collection("providerSubscriptions").doc("subscription-delete-me").set({
          uid,
          nextReconciliationAt: "2026-08-25T12:00:00.000Z",
          lastReconciliationError: "buyer@example.com failed"
        }),
        database.collection("providerSecrets").doc("secret-delete-me").set({
          uid,
          encrypted: { ciphertext: "encrypted-only" }
        }),
        database.collection("cloudSaveCleanupJobs").doc("cleanup-delete-me").set({
          uid,
          state: "pending",
          objectPaths: [`cloud-save-profiles/${uid}/profiles/default/revisions/4acb303f-18d2-4b98-b665-058c332271df.json`]
        }),
        database.collection("secondPlatformRequests").doc(uid).set({
          uid,
          requestedPlatform: "ios",
          state: "pending"
        }),
        database.collection("legacyOrders").doc("order-delete-me").set({
          buyerEmail: "buyer@example.com",
          firebaseUid: uid,
          stripeCheckoutSessionId: "order-delete-me"
        }),
        database.collection("legacyKeys").doc("key-delete-me").set({
          assignedOrderId: "order-delete-me",
          assignedEmail: "buyer@example.com",
          sheetTab: "English Steam",
          rowNumber: 42
        }),
        database.collection("outbox").doc("fulfillment-delete-me").set({
          kind: "fulfill_legacy_order",
          state: "pending",
          payload: { firebaseUid: uid, buyerEmail: "buyer@example.com" }
        }),
        database.collection("outbox").doc("conversion-delete-me").set({
          kind: "meta_conversion",
          state: "failed",
          payload: { subjectUidHash: sha256(uid), ipAddress: "192.0.2.1" },
          lastError: "buyer@example.com failed"
        }),
        database.collection("outbox").doc("deletion-delete-me").set({
          kind: "delete_account_data",
          state: "processing",
          payload: { uid }
        }),
        database.collection("storeAccountTokens").doc(stableDocumentId("store-account", "store-token")).set({ uid })
      ]);

      const result = await new AccountDeletionService(database, auth, adminStorage, {
        erase: async (subject) => {
          erasedLegacySubjects.push(subject);
          return { sheetEmailCellsCleared: 1, mailerLiteSubscribersForgotten: 1 };
        }
      }).purge(
        uid,
        new Date("2026-08-24T12:00:00.000Z")
      );
      expect(result).toMatchObject({
        deleted: true,
        pseudonymizedLegacyOrders: 1,
        scrubbedLegacyKeyAssignments: 1,
        scrubbedOutboxRows: 2,
        sheetEmailCellsCleared: 1,
        mailerLiteSubscribersForgotten: 1
      });

      const [order, key, fulfillment, conversion, deletion, grant, providerTransaction, providerSubscription, providerSecret, cleanupJob, secondPlatformRequest, user, accountSecurity, tombstone] = await Promise.all([
        database.collection("legacyOrders").doc("order-delete-me").get(),
        database.collection("legacyKeys").doc("key-delete-me").get(),
        database.collection("outbox").doc("fulfillment-delete-me").get(),
        database.collection("outbox").doc("conversion-delete-me").get(),
        database.collection("outbox").doc("deletion-delete-me").get(),
        database.collection("grants").doc("grant-delete-me").get(),
        database.collection("providerTransactions").doc("transaction-delete-me").get(),
        database.collection("providerSubscriptions").doc("subscription-delete-me").get(),
        database.collection("providerSecrets").doc("secret-delete-me").get(),
        database.collection("cloudSaveCleanupJobs").doc("cleanup-delete-me").get(),
        database.collection("secondPlatformRequests").doc(uid).get(),
        database.collection("users").doc(uid).get(),
        database.collection("accountSecurity").doc(uid).get(),
        database.collection("accountDeletionTombstones").doc(sha256(uid)).get()
      ]);
      expect(order.data()).toMatchObject({ firebaseUid: deletedUid, claimedByUid: deletedUid });
      expect(order.data()).not.toHaveProperty("buyerEmail");
      expect(key.data()).not.toHaveProperty("assignedEmail");
      expect(fulfillment.data()).toMatchObject({ state: "canceled", payload: { redacted: true } });
      expect(conversion.data()).toMatchObject({ state: "canceled", payload: { redacted: true } });
      expect(conversion.data()).not.toHaveProperty("lastError");
      expect(deletion.data()?.payload).toEqual({ uid });
      expect(grant.data()).toMatchObject({ uid: deletedUid, metadata: { accountDeleted: true } });
      expect(providerTransaction.data()).toMatchObject({
        uid: deletedUid,
        attributionDisabledReason: "account_deleted"
      });
      expect(providerSubscription.data()).toMatchObject({
        uid: deletedUid,
        nextReconciliationAt: null,
        reconciliationDisabledReason: "account_deleted"
      });
      expect(providerSubscription.data()).not.toHaveProperty("lastReconciliationError");
      expect(providerSecret.exists).toBe(false);
      expect(cleanupJob.exists).toBe(false);
      expect(secondPlatformRequest.exists).toBe(false);
      expect(user.exists).toBe(false);
      expect(accountSecurity.exists).toBe(false);
      expect(tombstone.data()?.deletedUid).toBe(deletedUid);
      expect(deletedAuthUsers).toEqual([uid]);
      expect(erasedLegacySubjects).toEqual([{
        emails: ["buyer@example.com"],
        sheetAssignments: [{ sheetTab: "English Steam", rowNumber: 42 }]
      }]);
      expect(deletedPrefixes.sort()).toEqual([
        `cloud-save-profile-uploads/${uid}/`,
        `cloud-save-profiles/${uid}/`
      ]);
    } finally {
      await deleteApp(app);
    }
  }, 30_000);
});
