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
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
});
