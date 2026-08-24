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
import { EntitlementStore } from "../src/infrastructure/entitlement-store.js";
import { sha256, stableDocumentId } from "../src/infrastructure/ids.js";

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
        ref(storage(context), "cloud-saves/player-1/slot-1/current.rmmzsave"),
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
      const object = ref(clientStorage, "cloud-saves/player-1/slot-1/current.rmmzsave");
      await assertFails(getBytes(object));
      await assertFails(listAll(ref(clientStorage, "cloud-saves/player-1")));
      await assertFails(uploadBytes(
        ref(clientStorage, "cloud-saves/player-1/slot-1/attacker.rmmzsave"),
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
        database.collection("entitlements").doc(uid).set({ uid }),
        database.collection("grants").doc("grant-delete-me").set({ uid, metadata: { email: "buyer@example.com" } }),
        database.collection("providerTransactions").doc("transaction-delete-me").set({ uid }),
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

      const [order, key, fulfillment, conversion, deletion, grant, user, tombstone] = await Promise.all([
        database.collection("legacyOrders").doc("order-delete-me").get(),
        database.collection("legacyKeys").doc("key-delete-me").get(),
        database.collection("outbox").doc("fulfillment-delete-me").get(),
        database.collection("outbox").doc("conversion-delete-me").get(),
        database.collection("outbox").doc("deletion-delete-me").get(),
        database.collection("grants").doc("grant-delete-me").get(),
        database.collection("users").doc(uid).get(),
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
      expect(user.exists).toBe(false);
      expect(tombstone.data()?.deletedUid).toBe(deletedUid);
      expect(deletedAuthUsers).toEqual([uid]);
      expect(erasedLegacySubjects).toEqual([{
        emails: ["buyer@example.com"],
        sheetAssignments: [{ sheetTab: "English Steam", rowNumber: 42 }]
      }]);
      expect(deletedPrefixes.sort()).toEqual([
        `cloud-save-uploads/${uid}/`,
        `cloud-saves/${uid}/`
      ]);
    } finally {
      await deleteApp(app);
    }
  }, 30_000);
});
