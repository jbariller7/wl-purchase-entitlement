import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";
import { AdminCloudSaveService } from "../src/admin/cloud-save-service.js";

const now = new Date("2026-08-25T12:00:00.000Z");
const uid = "customer-1";
const objectPath = "cloud-saves/customer-1/slots/save1/revisions/4acb303f-18d2-4b98-b665-058c332271df.json";

function manifest(path = objectPath): Record<string, unknown> {
  return {
    uid,
    slot: "save1",
    currentRevision: "4acb303f-18d2-4b98-b665-058c332271df",
    objectPath: path,
    byteLength: 1234,
    sha256: "a".repeat(64),
    updatedAt: "2026-08-25T11:45:00.000Z",
    previousRevisions: []
  };
}

function fakeFirestore(value: Record<string, unknown>, auditRows: Record<string, unknown>[]): Firestore {
  return {
    collection: (name: string) => {
      if (name === "cloudSaves") {
        return {
          doc: (requestedUid: string) => ({
            collection: (child: string) => ({
              doc: (slot: string) => ({
                get: async () => ({
                  exists: requestedUid === uid && ((child === "slots" && slot === "save1") || (child === "profiles" && slot === "default")),
                  data: () => value
                })
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
    }
  } as unknown as Firestore;
}

function fakeStorage(calls: Array<{ path: string; config?: Record<string, unknown> }>, exists = true): Storage {
  return {
    bucket: () => ({
      file: (path: string) => ({
        exists: async () => [exists],
        getSignedUrl: async (config: Record<string, unknown>) => {
          calls.push({ path, config });
          return ["https://storage.test/private-signed-url"];
        }
      })
    })
  } as unknown as Storage;
}

describe("audited administrator cloud-save downloads", () => {
  it("returns a five-minute private URL only after recording the support reason", async () => {
    const audits: Record<string, unknown>[] = [];
    const storageCalls: Array<{ path: string; config?: Record<string, unknown> }> = [];
    const result = await new AdminCloudSaveService(fakeFirestore(manifest(), audits), fakeStorage(storageCalls)).createDownload({
      actor: { uid: "admin-1", email: "owner@example.com" },
      uid,
      slot: "save1",
      reason: "Investigating a customer-reported save conflict.",
      now
    });

    expect(result).toMatchObject({
      downloadUrl: "https://storage.test/private-signed-url",
      expiresAt: "2026-08-25T12:05:00.000Z",
      manifest: { slot: "save1", byteLength: 1234 }
    });
    expect(storageCalls).toEqual([{ path: objectPath, config: { version: "v4", action: "read", expires: new Date("2026-08-25T12:05:00.000Z") } }]);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "cloud_save.download",
      targetId: uid,
      actorEmail: "owner@example.com",
      summary: expect.stringContaining("Investigating a customer-reported save conflict")
    });
    expect(JSON.stringify(audits[0])).not.toContain("private-signed-url");
  });

  it("refuses a manifest whose object path escapes the customer's immutable revision area", async () => {
    const audits: Record<string, unknown>[] = [];
    const storageCalls: Array<{ path: string; config?: Record<string, unknown> }> = [];
    await expect(new AdminCloudSaveService(
      fakeFirestore(manifest("cloud-saves/another-user/slots/save1/revisions/4acb303f-18d2-4b98-b665-058c332271df.json"), audits),
      fakeStorage(storageCalls)
    ).createDownload({
      actor: { uid: "admin-1", email: "owner@example.com" },
      uid,
      slot: "save1",
      reason: "Investigating a customer-reported save conflict.",
      now
    })).rejects.toMatchObject({ status: 409 });
    expect(storageCalls).toEqual([]);
    expect(audits).toEqual([]);
  });

  it("audits complete profile downloads without exposing their Storage path", async () => {
    const profilePath = "cloud-save-profiles/customer-1/profiles/default/revisions/4acb303f-18d2-4b98-b665-058c332271df.json";
    const audits: Record<string, unknown>[] = [];
    const storageCalls: Array<{ path: string; config?: Record<string, unknown> }> = [];
    const result = await new AdminCloudSaveService(fakeFirestore({
      uid,
      profileId: "default",
      name: "Japanese",
      currentRevision: "4acb303f-18d2-4b98-b665-058c332271df",
      objectPath: profilePath,
      byteLength: 4321,
      sha256: "b".repeat(64),
      createdAt: "2026-08-24T11:45:00.000Z",
      updatedAt: "2026-08-25T11:45:00.000Z",
      previousRevisions: []
    }, audits), fakeStorage(storageCalls)).createProfileDownload({
      actor: { uid: "admin-1", email: "owner@example.com" },
      uid,
      profileId: "default",
      reason: "Player explicitly requested save-file inspection.",
      now
    });

    expect(result).toMatchObject({
      downloadUrl: "https://storage.test/private-signed-url",
      manifest: { profileId: "default", name: "Japanese", byteLength: 4321 }
    });
    expect(storageCalls[0]?.path).toBe(profilePath);
    expect(audits[0]).toMatchObject({ action: "cloud_save_profile.download", targetId: uid });
    expect(JSON.stringify(audits[0])).not.toContain(profilePath);
    expect(JSON.stringify(audits[0])).not.toContain("private-signed-url");
  });
});
