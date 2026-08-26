import type { Firestore } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";
import { cloudSaveSlotSchema, type SaveManifest } from "../cloud-save/service.js";
import { isSafeCloudRevisionObjectPath } from "../cloud-save/cleanup-service.js";
import { cloudSaveProfileIdSchema, type CloudSaveProfileManifest } from "../cloud-save/profile-service.js";
import { HttpError } from "../http/auth.js";
import { recordAdminAudit, type AdminActor } from "./audit.js";

const ADMIN_DOWNLOAD_TTL_MS = 5 * 60 * 1000;

function downloadFilename(slot: string, now: Date): string {
  return `wonderlang-${slot}-${now.toISOString().replace(/[:.]/g, "-")}.json`;
}

export class AdminCloudSaveService {
  constructor(private readonly db: Firestore, private readonly storage: Storage) {}

  async createDownload(input: {
    actor: AdminActor;
    uid: string;
    slot: string;
    reason: string;
    now: Date;
  }): Promise<{
    downloadUrl: string;
    filename: string;
    expiresAt: string;
    manifest: Pick<SaveManifest, "slot" | "currentRevision" | "byteLength" | "sha256" | "updatedAt">;
  }> {
    const slot = cloudSaveSlotSchema.safeParse(input.slot);
    if (!slot.success) throw new HttpError(400, slot.error.issues[0]?.message ?? "Invalid cloud-save slot.");
    const snapshot = await this.db.collection("cloudSaves").doc(input.uid).collection("slots").doc(slot.data).get();
    if (!snapshot.exists) throw new HttpError(404, "No retained cloud save exists for this slot.");
    const manifest = snapshot.data() as SaveManifest;
    if (manifest.uid !== input.uid || manifest.slot !== slot.data || !isSafeCloudRevisionObjectPath(manifest.objectPath, input.uid)) {
      throw new HttpError(409, "The retained cloud-save manifest failed its security validation.");
    }

    const file = this.storage.bucket().file(manifest.objectPath);
    const [exists] = await file.exists();
    if (!exists) throw new HttpError(404, "The retained cloud-save object no longer exists.");
    const expiresAt = new Date(input.now.getTime() + ADMIN_DOWNLOAD_TTL_MS);
    const [downloadUrl] = await file.getSignedUrl({ version: "v4", action: "read", expires: expiresAt });

    // The download is returned only after the audit record succeeds. The
    // signed URL itself is deliberately excluded from Firestore and logs.
    await recordAdminAudit({
      db: this.db,
      actor: input.actor,
      action: "cloud_save.download",
      targetType: "user",
      targetId: input.uid,
      summary: `Downloaded retained ${slot.data} for customer support: ${input.reason}`,
      metadata: {
        slot: slot.data,
        revision: manifest.currentRevision,
        byteLength: manifest.byteLength,
        sha256: manifest.sha256,
        expiresAt: expiresAt.toISOString()
      },
      now: input.now
    });

    return {
      downloadUrl,
      filename: downloadFilename(slot.data, input.now),
      expiresAt: expiresAt.toISOString(),
      manifest: {
        slot: manifest.slot,
        currentRevision: manifest.currentRevision,
        byteLength: manifest.byteLength,
        sha256: manifest.sha256,
        updatedAt: manifest.updatedAt
      }
    };
  }

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
}
