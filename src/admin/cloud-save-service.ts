import { createHash, randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";
import { isSafeCloudRevisionObjectPath } from "../cloud-save/cleanup-service.js";
import { cloudSaveProfileIdSchema, validateCloudProfileBundle, type CloudSaveProfileManifest } from "../cloud-save/profile-service.js";
import { HttpError } from "../http/auth.js";
import { recordAdminAudit, type AdminActor } from "./audit.js";

const ADMIN_DOWNLOAD_TTL_MS = 5 * 60 * 1000;

export class AdminCloudSaveService {
  constructor(private readonly db: Firestore, private readonly storage: Storage) {}

  async createProfileDownload(input: {
    actor: AdminActor;
    uid: string;
    profileId: string;
    reason: string;
    now: Date;
  }): Promise<{
    downloadUrl: string;
    filename: string;
    expiresAt: string;
    manifest: { profileId: string; name: string; currentRevision: string; byteLength: number; sha256: string; updatedAt: string };
  }> {
    const profileId = cloudSaveProfileIdSchema.safeParse(input.profileId);
    if (!profileId.success) throw new HttpError(400, "Invalid cloud-save profile ID.");
    const snapshot = await this.db.collection("cloudSaves").doc(input.uid).collection("profiles").doc(profileId.data).get();
    if (!snapshot.exists) throw new HttpError(404, "Cloud-save profile was not found.");
    const manifest = snapshot.data() as CloudSaveProfileManifest;
    if (manifest.uid !== input.uid || manifest.profileId !== profileId.data || !manifest.currentRevision || !manifest.sha256 ||
        !manifest.objectPath || !isSafeCloudRevisionObjectPath(manifest.objectPath, input.uid)) {
      throw new HttpError(409, "The retained cloud-profile manifest failed its security validation.");
    }
    const file = this.storage.bucket().file(manifest.objectPath);
    const [exists] = await file.exists();
    if (!exists) throw new HttpError(404, "The retained cloud-profile object no longer exists.");
    const expiresAt = new Date(input.now.getTime() + ADMIN_DOWNLOAD_TTL_MS);
    const [downloadUrl] = await file.getSignedUrl({ version: "v4", action: "read", expires: expiresAt });
    await recordAdminAudit({
      db: this.db,
      actor: input.actor,
      action: "cloud_save_profile.download",
      targetType: "user",
      targetId: input.uid,
      summary: `Downloaded retained cloud profile ${manifest.name} for customer support: ${input.reason}`,
      metadata: {
        profileId: manifest.profileId,
        profileName: manifest.name,
        revision: manifest.currentRevision,
        byteLength: manifest.byteLength,
        sha256: manifest.sha256,
        expiresAt: expiresAt.toISOString()
      },
      now: input.now
    });
    return {
      downloadUrl,
      filename: `wonderlang-profile-${manifest.name.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 40)}-${input.now.toISOString().replace(/[:.]/g, "-")}.json`,
      expiresAt: expiresAt.toISOString(),
      manifest: {
        profileId: manifest.profileId,
        name: manifest.name,
        currentRevision: manifest.currentRevision,
        byteLength: manifest.byteLength,
        sha256: manifest.sha256,
        updatedAt: manifest.updatedAt
      }
    };
  }

  async restoreProfileRevision(input: {
    actor: AdminActor;
    uid: string;
    profileId: string;
    revision: string;
    reason: string;
    now: Date;
  }): Promise<{ profileId: string; restoredRevision: string; replacedRevision: string }> {
    const profileId = cloudSaveProfileIdSchema.safeParse(input.profileId);
    if (!profileId.success || !/^[0-9a-f-]{36}$/i.test(input.revision)) {
      throw new HttpError(400, "Invalid cloud-profile revision selection.");
    }
    const ref = this.db.collection("cloudSaves").doc(input.uid).collection("profiles").doc(profileId.data);
    const initial = await ref.get();
    if (!initial.exists) throw new HttpError(404, "Cloud-save profile was not found.");
    const initialManifest = initial.data() as CloudSaveProfileManifest;
    const selected = initialManifest.previousRevisions.find((item) => item.revision === input.revision);
    if (!selected || !isSafeCloudRevisionObjectPath(selected.objectPath, input.uid)) {
      throw new HttpError(404, "That retained profile version is no longer available.");
    }
    const [contents] = await this.storage.bucket().file(selected.objectPath).download();
    validateCloudProfileBundle(contents, profileId.data);
    const digest = createHash("sha256").update(contents).digest("hex");
    const result = await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new HttpError(404, "Cloud-save profile was not found.");
      const current = snapshot.data() as CloudSaveProfileManifest;
      const retained = current.previousRevisions.find((item) =>
        item.revision === input.revision && item.objectPath === selected.objectPath
      );
      if (!retained || !current.currentRevision || !current.objectPath || !isSafeCloudRevisionObjectPath(current.objectPath, input.uid)) {
        throw new HttpError(409, "The profile changed while its previous version was being restored.");
      }
      const candidates = [
        { revision: current.currentRevision, objectPath: current.objectPath, updatedAt: current.updatedAt },
        ...current.previousRevisions.filter((item) => item.revision !== retained.revision)
      ];
      const previousRevisions = candidates.slice(0, 3);
      const prunedObjectPaths = candidates.slice(3).map((item) => item.objectPath);
      transaction.set(ref, {
        ...current,
        currentRevision: retained.revision,
        objectPath: retained.objectPath,
        byteLength: contents.byteLength,
        sha256: digest,
        updatedAt: input.now.toISOString(),
        previousRevisions
      });
      if (prunedObjectPaths.length) {
        transaction.set(this.db.collection("cloudSaveCleanupJobs").doc(randomUUID()), {
          state: "pending",
          uid: input.uid,
          objectPaths: prunedObjectPaths,
          createdAt: input.now.toISOString(),
          attemptCount: 0
        });
      }
      return { replacedRevision: current.currentRevision };
    });
    await recordAdminAudit({
      db: this.db,
      actor: input.actor,
      action: "cloud_save_profile.restore_revision",
      targetType: "user",
      targetId: input.uid,
      summary: `Restored a previous version of cloud profile ${initialManifest.name}: ${input.reason}`,
      metadata: {
        profileId: profileId.data,
        restoredRevision: input.revision,
        replacedRevision: result.replacedRevision,
        byteLength: contents.byteLength,
        sha256: digest
      },
      now: input.now
    });
    return { profileId: profileId.data, restoredRevision: input.revision, replacedRevision: result.replacedRevision };
  }
}
