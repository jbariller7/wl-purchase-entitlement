import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";
import type { EntitlementStore } from "../src/infrastructure/entitlement-store.js";
import { CloudSaveProfileService, type CloudSaveProfileManifest } from "../src/cloud-save/profile-service.js";

const uid = "restore-owner";
const now = new Date("2026-08-27T10:00:00.000Z");
const currentRevision = "11111111-1111-4111-8111-111111111111";
const selectedRevision = "22222222-2222-4222-8222-222222222222";
const otherRevision = "33333333-3333-4333-8333-333333333333";

function objectPath(owner: string, revision: string): string {
  return `cloud-save-profiles/${owner}/profiles/default/revisions/${revision}.json`;
}

function manifest(selectedPath = objectPath(uid, selectedRevision)): CloudSaveProfileManifest {
  return {
    uid,
    profileId: "default",
    name: "Default",
    createdAt: "2026-08-27T08:00:00.000Z",
    updatedAt: "2026-08-27T09:45:00.000Z",
    currentRevision,
    objectPath: objectPath(uid, currentRevision),
    byteLength: 10,
    sha256: "a".repeat(64),
    previousRevisions: [
      { revision: selectedRevision, objectPath: selectedPath, updatedAt: "2026-08-27T09:30:00.000Z" },
      { revision: otherRevision, objectPath: objectPath(uid, otherRevision), updatedAt: "2026-08-27T09:15:00.000Z" }
    ]
  };
}

function fakeFirestore(initial: CloudSaveProfileManifest): { database: Firestore; read: () => CloudSaveProfileManifest } {
  let value = initial;
  const profileRef = {
    get: async () => ({ exists: true, data: () => value }),
    setValue: (next: CloudSaveProfileManifest) => { value = next; }
  };
  const database = {
    collection: (name: string) => {
      if (name === "cloudSaves") return { doc: () => ({ collection: () => ({ doc: () => profileRef }) }) };
      if (name === "cloudSaveCleanupJobs") return { doc: () => ({ setValue: () => undefined, delete: async () => undefined, update: async () => undefined }) };
      throw new Error(`Unexpected collection ${name}`);
    },
    runTransaction: async (callback: (transaction: {
      get: (ref: typeof profileRef) => Promise<unknown>;
      set: (ref: typeof profileRef, next: CloudSaveProfileManifest) => void;
    }) => Promise<unknown>) => callback({
      get: (ref) => ref.get(),
      set: (ref, next) => ref.setValue(next)
    })
  };
  return { database: database as unknown as Firestore, read: () => value };
}

function entitledStore(): EntitlementStore {
  return { effectiveEntitlements: async () => ({ cloudSave: true }) } as unknown as EntitlementStore;
}

function backupContents(): Buffer {
  return Buffer.from(JSON.stringify({
    magic: "WL_CLOUD_PROFILE",
    version: 1,
    profileId: "default",
    files: { global: "[]", file1: JSON.stringify({ restored: true }) }
  }));
}

describe("player-owned cloud-profile backup restoration", () => {
  it("promotes only a retained owner-bound backup and keeps the replaced current version", async () => {
    const state = fakeFirestore(manifest());
    const downloads: string[] = [];
    const storage = {
      bucket: () => ({ file: (path: string) => ({ download: async () => { downloads.push(path); return [backupContents()]; } }) })
    } as unknown as Storage;
    const result = await new CloudSaveProfileService(state.database, storage, entitledStore())
      .restoreRevision(uid, "default", selectedRevision, currentRevision, now);

    expect(result.currentRevision).toBe(selectedRevision);
    expect(result.backups.map((backup) => backup.revision)).toEqual([currentRevision, otherRevision]);
    expect(JSON.stringify(result)).not.toContain("objectPath");
    expect(state.read().objectPath).toBe(objectPath(uid, selectedRevision));
    expect(downloads).toEqual([objectPath(uid, selectedRevision)]);
  });

  it("rejects stale confirmation state before reading a backup object", async () => {
    const state = fakeFirestore(manifest());
    let downloaded = false;
    const storage = {
      bucket: () => ({ file: () => ({ download: async () => { downloaded = true; return [backupContents()]; } }) })
    } as unknown as Storage;
    await expect(new CloudSaveProfileService(state.database, storage, entitledStore())
      .restoreRevision(uid, "default", selectedRevision, otherRevision, now))
      .rejects.toMatchObject({ status: 409 });
    expect(downloaded).toBe(false);
  });

  it("rejects a retained pointer outside the authenticated owner's storage prefix", async () => {
    const state = fakeFirestore(manifest(objectPath("another-user", selectedRevision)));
    let downloaded = false;
    const storage = {
      bucket: () => ({ file: () => ({ download: async () => { downloaded = true; return [backupContents()]; } }) })
    } as unknown as Storage;
    await expect(new CloudSaveProfileService(state.database, storage, entitledStore())
      .restoreRevision(uid, "default", selectedRevision, currentRevision, now))
      .rejects.toMatchObject({ status: 404 });
    expect(downloaded).toBe(false);
  });
});
