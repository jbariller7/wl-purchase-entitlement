import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";
import { AdminCloudSaveService } from "../src/admin/cloud-save-service.js";

const now = new Date("2026-08-25T12:00:00.000Z");
const uid = "customer-1";
const profilePath = "cloud-save-profiles/customer-1/profiles/default/revisions/4acb303f-18d2-4b98-b665-058c332271df.json";

function profileManifest(path = profilePath): Record<string, unknown> {
  return {
    uid,
    profileId: "default",
    name: "Japanese",
    currentRevision: "4acb303f-18d2-4b98-b665-058c332271df",
    objectPath: path,
    byteLength: 4321,
    sha256: "b".repeat(64),
    createdAt: "2026-08-24T11:45:00.000Z",
    updatedAt: "2026-08-25T11:45:00.000Z",
    previousRevisions: []
  };
}

function fakeFirestore(value: Record<string, unknown>, auditRows: Record<string, unknown>[]): Firestore {
  let currentValue = value;
  const database = {
    collection: (name: string) => {
      if (name === "cloudSaves") {
        return {
          doc: (requestedUid: string) => ({
            collection: (child: string) => ({
              doc: (profileId: string) => ({
                get: async () => ({
                  exists: requestedUid === uid && child === "profiles" && profileId === "default",
                  data: () => currentValue
                }),
                _set: (next: Record<string, unknown>) => { currentValue = next; }
              })
            })
          })
        };
      }
      if (name === "adminAudit") {
        return {
          doc: () => ({ id: "audit-1", create: async (row: Record<string, unknown>) => { auditRows.push(row); } })
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    },
    runTransaction: async (callback: (transaction: {
      get: (ref: { get: () => Promise<unknown> }) => Promise<unknown>;
      set: (ref: { _set: (value: Record<string, unknown>) => void }, value: Record<string, unknown>) => void;
    }) => Promise<unknown>) => callback({
      get: (ref) => ref.get(),
      set: (ref, next) => ref._set(next)
    })
  };
  return database as unknown as Firestore;
}

function fakeStorage(calls: Array<{ path: string; config?: Record<string, unknown> }>, exists = true, contents?: Buffer): Storage {
  return {
    bucket: () => ({
      file: (path: string) => ({
        exists: async () => [exists],
        download: async () => [contents ?? Buffer.from("{}")],
        getSignedUrl: async (config: Record<string, unknown>) => {
          calls.push({ path, config });
          return ["https://storage.test/private-signed-url"];
        }
      })
    })
  } as unknown as Storage;
}

describe("audited administrator cloud-profile downloads", () => {
  it("returns a five-minute private URL only after recording the support reason", async () => {
    const audits: Record<string, unknown>[] = [];
    const storageCalls: Array<{ path: string; config?: Record<string, unknown> }> = [];
    const result = await new AdminCloudSaveService(fakeFirestore(profileManifest(), audits), fakeStorage(storageCalls)).createProfileDownload({
      actor: { uid: "admin-1", email: "owner@example.com" },
      uid,
      profileId: "default",
      reason: "Player explicitly requested save-file inspection.",
      now
    });

    expect(result).toMatchObject({
      downloadUrl: "https://storage.test/private-signed-url",
      expiresAt: "2026-08-25T12:05:00.000Z",
      manifest: { profileId: "default", name: "Japanese", byteLength: 4321 }
    });
    expect(storageCalls).toEqual([{ path: profilePath, config: { version: "v4", action: "read", expires: new Date("2026-08-25T12:05:00.000Z") } }]);
    expect(audits[0]).toMatchObject({ action: "cloud_save_profile.download", targetId: uid, actorEmail: "owner@example.com" });
    expect(JSON.stringify(audits[0])).not.toContain(profilePath);
    expect(JSON.stringify(audits[0])).not.toContain("private-signed-url");
  });

  it("refuses a profile object path belonging to another account", async () => {
    const audits: Record<string, unknown>[] = [];
    const storageCalls: Array<{ path: string; config?: Record<string, unknown> }> = [];
    await expect(new AdminCloudSaveService(
      fakeFirestore(profileManifest(profilePath.replace("customer-1", "another-user")), audits),
      fakeStorage(storageCalls)
    ).createProfileDownload({
      actor: { uid: "admin-1", email: "owner@example.com" },
      uid,
      profileId: "default",
      reason: "Investigating a customer-reported save conflict.",
      now
    })).rejects.toMatchObject({ status: 409 });
    expect(storageCalls).toEqual([]);
    expect(audits).toEqual([]);
  });

  it("restores an immutable previous whole-profile version and audits the change", async () => {
    const previousRevision = "5bcb303f-18d2-4b98-b665-058c332271df";
    const previousPath = `cloud-save-profiles/${uid}/profiles/default/revisions/${previousRevision}.json`;
    const contents = Buffer.from(JSON.stringify({
      magic: "WL_CLOUD_PROFILE",
      version: 1,
      profileId: "default",
      files: { global: "[]", file1: "{}" }
    }));
    const audits: Record<string, unknown>[] = [];
    const database = fakeFirestore({
      ...profileManifest(),
      previousRevisions: [{ revision: previousRevision, objectPath: previousPath, updatedAt: "2026-08-24T11:45:00.000Z" }]
    }, audits);
    const result = await new AdminCloudSaveService(database, fakeStorage([], true, contents)).restoreProfileRevision({
      actor: { uid: "admin-1", email: "owner@example.com" },
      uid,
      profileId: "default",
      revision: previousRevision,
      reason: "Player asked support to recover yesterday's complete profile.",
      now
    });
    expect(result).toEqual({
      profileId: "default",
      restoredRevision: previousRevision,
      replacedRevision: "4acb303f-18d2-4b98-b665-058c332271df"
    });
    expect(audits[0]).toMatchObject({ action: "cloud_save_profile.restore_revision", targetId: uid });
    expect(JSON.stringify(audits[0])).not.toContain(previousPath);
  });
});
