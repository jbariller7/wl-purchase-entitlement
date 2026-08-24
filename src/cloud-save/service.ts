import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";
import { z } from "zod";
import type { EntitlementStore } from "../infrastructure/entitlement-store.js";
import { sha256 } from "../infrastructure/ids.js";
import { HttpError } from "../http/auth.js";

const MAX_SAVE_BYTES = 5 * 1024 * 1024;
const URL_TTL_MS = 10 * 60 * 1000;

export const prepareUploadSchema = z.object({
  slot: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  byteLength: z.number().int().positive().max(MAX_SAVE_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  baseRevision: z.string().uuid().nullable().optional()
});

export const finalizeUploadSchema = z.object({
  uploadId: z.string().uuid()
});

interface PendingUpload {
  uid: string;
  slot: string;
  uploadId: string;
  objectPath: string;
  byteLength: number;
  sha256: string;
  baseRevision: string | null;
  createdAt: string;
  expiresAt: string;
  state: "pending" | "complete" | "conflict";
}

interface SaveManifest {
  uid: string;
  slot: string;
  currentRevision: string;
  objectPath: string;
  byteLength: number;
  sha256: string;
  updatedAt: string;
  previousRevisions: Array<{ revision: string; objectPath: string; updatedAt: string }>;
}

export function cloudObjectMatches(contents: Buffer, expected: { byteLength: number; sha256: string }): boolean {
  return contents.byteLength === expected.byteLength && sha256(contents) === expected.sha256;
}

export function cloudRevisionConflicts(baseRevision: string | null, currentRevision: string | null): boolean {
  return baseRevision !== currentRevision;
}

export class CloudSaveService {
  constructor(
    private readonly db: Firestore,
    private readonly storage: Storage,
    private readonly entitlements: EntitlementStore
  ) {}

  private async requireCloudSave(uid: string, now: Date): Promise<void> {
    const effective = await this.entitlements.effectiveEntitlements(uid, now);
    if (!effective.cloudSave) {
      throw new HttpError(403, "Cloud save requires an active monthly subscription or lifetime access.");
    }
  }

  async prepareUpload(uid: string, request: z.infer<typeof prepareUploadSchema>, now: Date): Promise<{
    uploadId: string;
    uploadUrl: string;
    expiresAt: string;
  }> {
    await this.requireCloudSave(uid, now);
    const uploadId = randomUUID();
    const expiresAt = new Date(now.getTime() + URL_TTL_MS);
    const objectPath = `cloud-saves/${uid}/slots/${request.slot}/${uploadId}.json`;
    const pending: PendingUpload = {
      uid,
      slot: request.slot,
      uploadId,
      objectPath,
      byteLength: request.byteLength,
      sha256: request.sha256,
      baseRevision: request.baseRevision ?? null,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      state: "pending"
    };
    await this.db.collection("cloudSaveUploads").doc(uploadId).create(pending);
    const [uploadUrl] = await this.storage.bucket().file(objectPath).getSignedUrl({
      version: "v4",
      action: "write",
      expires: expiresAt,
      contentType: "application/json"
    });
    return { uploadId, uploadUrl, expiresAt: expiresAt.toISOString() };
  }

  async finalizeUpload(uid: string, uploadId: string, now: Date): Promise<SaveManifest> {
    await this.requireCloudSave(uid, now);
    const uploadRef = this.db.collection("cloudSaveUploads").doc(uploadId);
    const uploadSnapshot = await uploadRef.get();
    if (!uploadSnapshot.exists) throw new HttpError(404, "Cloud-save upload was not found.");
    const pending = uploadSnapshot.data() as PendingUpload;
    if (pending.uid !== uid) throw new HttpError(403, "Cloud-save upload belongs to another account.");
    if (pending.state === "complete") {
      const manifest = await this.manifest(uid, pending.slot);
      if (!manifest) throw new Error("Completed upload is missing its manifest.");
      return manifest;
    }
    if (Date.parse(pending.expiresAt) < now.getTime()) throw new HttpError(410, "Cloud-save upload expired.");

    const file = this.storage.bucket().file(pending.objectPath);
    const [exists] = await file.exists();
    if (!exists) throw new HttpError(409, "Upload the save file before finalizing it.");
    const [contents] = await file.download();
    if (!cloudObjectMatches(contents, pending)) {
      await file.delete({ ignoreNotFound: true });
      throw new HttpError(422, "Uploaded cloud save failed its size or SHA-256 integrity check.");
    }

    const manifestRef = this.db.collection("cloudSaves").doc(uid).collection("slots").doc(pending.slot);
    const result = await this.db.runTransaction(async (transaction): Promise<
      { manifest: SaveManifest } | { conflictRevision: string | null }
    > => {
      const [freshUpload, currentSnapshot] = await Promise.all([
        transaction.get(uploadRef),
        transaction.get(manifestRef)
      ]);
      const fresh = freshUpload.data() as PendingUpload;
      const current = currentSnapshot.data() as SaveManifest | undefined;
      if (fresh.state === "complete" && current) return { manifest: current };
      const expected = fresh.baseRevision;
      const actual = current?.currentRevision ?? null;
      if (cloudRevisionConflicts(expected, actual)) {
        transaction.update(uploadRef, { state: "conflict", conflictRevision: actual, updatedAt: now.toISOString() });
        return { conflictRevision: actual };
      }
      const previous = current
        ? [
            { revision: current.currentRevision, objectPath: current.objectPath, updatedAt: current.updatedAt },
            ...(current.previousRevisions ?? [])
          ].slice(0, 3)
        : [];
      const manifest: SaveManifest = {
        uid,
        slot: fresh.slot,
        currentRevision: fresh.uploadId,
        objectPath: fresh.objectPath,
        byteLength: fresh.byteLength,
        sha256: fresh.sha256,
        updatedAt: now.toISOString(),
        previousRevisions: previous
      };
      transaction.set(manifestRef, manifest);
      transaction.update(uploadRef, { state: "complete", completedAt: now.toISOString() });
      return { manifest };
    });
    if ("conflictRevision" in result) {
      throw new HttpError(409, `Cloud-save conflict: current revision is ${result.conflictRevision ?? "none"}.`);
    }
    return result.manifest;
  }

  async manifest(uid: string, slot: string): Promise<SaveManifest | undefined> {
    const snapshot = await this.db.collection("cloudSaves").doc(uid).collection("slots").doc(slot).get();
    return snapshot.exists ? snapshot.data() as SaveManifest : undefined;
  }

  async list(uid: string, now: Date): Promise<Array<Omit<SaveManifest, "objectPath" | "previousRevisions">>> {
    await this.requireCloudSave(uid, now);
    const snapshot = await this.db.collection("cloudSaves").doc(uid).collection("slots").get();
    return snapshot.docs.map((doc) => {
      const manifest = doc.data() as SaveManifest;
      return {
        uid: manifest.uid,
        slot: manifest.slot,
        currentRevision: manifest.currentRevision,
        byteLength: manifest.byteLength,
        sha256: manifest.sha256,
        updatedAt: manifest.updatedAt
      };
    }).sort((a, b) => a.slot.localeCompare(b.slot));
  }

  async downloadUrl(uid: string, slot: string, now: Date): Promise<{ downloadUrl: string; manifest: Omit<SaveManifest, "objectPath" | "previousRevisions"> }> {
    await this.requireCloudSave(uid, now);
    const manifest = await this.manifest(uid, slot);
    if (!manifest) throw new HttpError(404, "No cloud save exists for this slot.");
    const [downloadUrl] = await this.storage.bucket().file(manifest.objectPath).getSignedUrl({
      version: "v4",
      action: "read",
      expires: new Date(now.getTime() + URL_TTL_MS)
    });
    return {
      downloadUrl,
      manifest: {
        uid: manifest.uid,
        slot: manifest.slot,
        currentRevision: manifest.currentRevision,
        byteLength: manifest.byteLength,
        sha256: manifest.sha256,
        updatedAt: manifest.updatedAt
      }
    };
  }
}
