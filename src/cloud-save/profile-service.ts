import { createHash, randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";
import { z } from "zod";
import type { EntitlementStore } from "../infrastructure/entitlement-store.js";
import { HttpError } from "../http/auth.js";
import { isSafeCloudRevisionObjectPath } from "./cleanup-service.js";

const MAX_PROFILES = 6;
const MAX_PROFILE_BYTES = 32 * 1024 * 1024;
const URL_TTL_MS = 10 * 60 * 1000;
const PROFILE_ID_PATTERN = /^(?:default|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const SAVE_OBJECT_NAME = /^(?:global|file(?:0|[1-9]|1[0-9]|20))$/;
const RETAINED_PRIOR_REVISIONS = 3;

export const cloudSaveProfileIdSchema = z.string().regex(PROFILE_ID_PATTERN, "Invalid cloud-save profile ID.");
export const cloudSaveProfileNameSchema = z.string().trim().min(1).max(40);
export const createCloudSaveProfileSchema = z.object({ name: cloudSaveProfileNameSchema });
export const renameCloudSaveProfileSchema = z.object({ name: cloudSaveProfileNameSchema });
export const prepareProfileUploadSchema = z.object({
  byteLength: z.number().int().positive().max(MAX_PROFILE_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  baseRevision: z.string().uuid().nullable().optional()
});
export const finalizeProfileUploadSchema = z.object({ uploadId: z.string().uuid() });

export interface CloudRevisionPointer {
  revision: string;
  objectPath: string;
  updatedAt: string;
}

export function retainedCloudRevisionPlan(current: {
  currentRevision: string;
  objectPath: string;
  updatedAt: string;
  previousRevisions: CloudRevisionPointer[];
} | undefined): { retained: CloudRevisionPointer[]; prunedObjectPaths: string[] } {
  if (!current) return { retained: [], prunedObjectPaths: [] };
  const candidates: CloudRevisionPointer[] = [
    { revision: current.currentRevision, objectPath: current.objectPath, updatedAt: current.updatedAt },
    ...(current.previousRevisions ?? [])
  ];
  return {
    retained: candidates.slice(0, RETAINED_PRIOR_REVISIONS),
    prunedObjectPaths: candidates.slice(RETAINED_PRIOR_REVISIONS).map((revision) => revision.objectPath)
  };
}

export function cloudObjectMatches(contents: Buffer, expected: { byteLength: number; sha256: string }): boolean {
  return contents.byteLength === expected.byteLength &&
    createHash("sha256").update(contents).digest("hex") === expected.sha256;
}

export function cloudRevisionConflicts(baseRevision: string | null, currentRevision: string | null): boolean {
  return baseRevision !== currentRevision;
}

export interface CloudSaveProfileManifest {
  uid: string;
  profileId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  renamedAt?: string;
  currentRevision: string | null;
  objectPath: string | null;
  byteLength: number;
  sha256: string | null;
  previousRevisions: CloudRevisionPointer[];
}

interface PendingProfileUpload {
  uid: string;
  profileId: string;
  uploadId: string;
  objectPath: string;
  byteLength: number;
  sha256: string;
  baseRevision: string | null;
  createdAt: string;
  expiresAt: string;
  state: "pending" | "complete" | "conflict";
  cleanupObjectPaths?: string[];
}

export function cloudProfileStagingObjectPath(uid: string, uploadId: string): string {
  return `cloud-save-profile-uploads/${uid}/${uploadId}.json`;
}

export function cloudProfileRevisionObjectPath(uid: string, profileId: string, uploadId: string): string {
  const valid = cloudSaveProfileIdSchema.safeParse(profileId);
  if (!valid.success) throw new Error(valid.error.issues[0]?.message ?? "Invalid cloud-save profile ID.");
  return `cloud-save-profiles/${uid}/profiles/${valid.data}/revisions/${uploadId}.json`;
}

export function validateCloudProfileBundle(contents: Buffer, expectedProfileId: string): void {
  let value: unknown;
  try { value = JSON.parse(contents.toString("utf8")); }
  catch { throw new HttpError(422, "Uploaded cloud profile is not valid JSON."); }
  if (!value || typeof value !== "object") throw new HttpError(422, "Uploaded cloud profile is invalid.");
  const bundle = value as Record<string, unknown>;
  if (bundle.magic !== "WL_CLOUD_PROFILE" || bundle.version !== 1 || bundle.profileId !== expectedProfileId) {
    throw new HttpError(422, "Uploaded cloud profile metadata is invalid.");
  }
  if (!bundle.files || typeof bundle.files !== "object" || Array.isArray(bundle.files)) {
    throw new HttpError(422, "Uploaded cloud profile has no save-file set.");
  }
  const files = bundle.files as Record<string, unknown>;
  const names = Object.keys(files);
  if (!names.includes("global") || names.length > 22 || names.some((name) => !SAVE_OBJECT_NAME.test(name))) {
    throw new HttpError(422, "Uploaded cloud profile contains an invalid save-file set.");
  }
  if (names.some((name) => typeof files[name] !== "string" || !(files[name] as string).length)) {
    throw new HttpError(422, "Uploaded cloud profile contains invalid save data.");
  }
}

function isPreconditionFailure(error: unknown): boolean {
  const candidate = error as { code?: number | string; statusCode?: number };
  return candidate.code === 412 || candidate.code === "412" || candidate.statusCode === 412;
}

function publicProfile(manifest: CloudSaveProfileManifest): Omit<CloudSaveProfileManifest, "uid" | "objectPath" | "previousRevisions"> {
  return {
    profileId: manifest.profileId,
    name: manifest.name,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    currentRevision: manifest.currentRevision,
    byteLength: manifest.byteLength,
    sha256: manifest.sha256
  };
}

export class CloudSaveProfileService {
  constructor(
    private readonly db: Firestore,
    private readonly storage: Storage,
    private readonly entitlements: EntitlementStore
  ) {}

  private profiles(uid: string) {
    return this.db.collection("cloudSaves").doc(uid).collection("profiles");
  }

  private async requireCloudSave(uid: string, now: Date): Promise<void> {
    const effective = await this.entitlements.effectiveEntitlements(uid, now);
    if (!effective.cloudSave) {
      throw new HttpError(403, "Cloud save requires an active monthly subscription or Premium Lifetime Pass.");
    }
  }

  private async ensureDefault(uid: string, now: Date): Promise<void> {
    const collection = this.profiles(uid);
    const existing = await collection.limit(1).get();
    if (!existing.empty) return;
    const ref = collection.doc("default");
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (snapshot.exists) return;
      const manifest: CloudSaveProfileManifest = {
        uid,
        profileId: "default",
        name: "Default",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        currentRevision: null,
        objectPath: null,
        byteLength: 0,
        sha256: null,
        previousRevisions: []
      };
      transaction.create(ref, manifest);
    });
  }

  async list(uid: string, now: Date): Promise<Array<ReturnType<typeof publicProfile>>> {
    await this.requireCloudSave(uid, now);
    await this.ensureDefault(uid, now);
    const snapshot = await this.profiles(uid).get();
    return snapshot.docs
      .map((doc) => publicProfile(doc.data() as CloudSaveProfileManifest))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  async create(uid: string, name: string, now: Date): Promise<ReturnType<typeof publicProfile>> {
    await this.requireCloudSave(uid, now);
    await this.ensureDefault(uid, now);
    const profileId = randomUUID();
    const ref = this.profiles(uid).doc(profileId);
    const manifest = await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(this.profiles(uid));
      if (snapshot.size >= MAX_PROFILES) throw new HttpError(409, "An account can have at most six save profiles.");
      const value: CloudSaveProfileManifest = {
        uid,
        profileId,
        name,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        currentRevision: null,
        objectPath: null,
        byteLength: 0,
        sha256: null,
        previousRevisions: []
      };
      transaction.create(ref, value);
      return value;
    });
    return publicProfile(manifest);
  }

  async rename(uid: string, profileId: string, name: string, now: Date): Promise<ReturnType<typeof publicProfile>> {
    await this.requireCloudSave(uid, now);
    const ref = this.profiles(uid).doc(profileId);
    const manifest = await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new HttpError(404, "Cloud-save profile was not found.");
      const current = snapshot.data() as CloudSaveProfileManifest;
      const next = { ...current, name, renamedAt: now.toISOString() };
      transaction.set(ref, next);
      return next;
    });
    return publicProfile(manifest);
  }

  async prepareUpload(uid: string, profileId: string, request: z.infer<typeof prepareProfileUploadSchema>, now: Date): Promise<{
    uploadId: string;
    uploadUrl: string;
    expiresAt: string;
  }> {
    await this.requireCloudSave(uid, now);
    const profile = await this.profiles(uid).doc(profileId).get();
    if (!profile.exists) throw new HttpError(404, "Cloud-save profile was not found.");
    const uploadId = randomUUID();
    const expiresAt = new Date(now.getTime() + URL_TTL_MS);
    const objectPath = cloudProfileStagingObjectPath(uid, uploadId);
    const pending: PendingProfileUpload = {
      uid,
      profileId,
      uploadId,
      objectPath,
      byteLength: request.byteLength,
      sha256: request.sha256,
      baseRevision: request.baseRevision ?? null,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      state: "pending"
    };
    await this.db.collection("cloudSaveProfileUploads").doc(uploadId).create(pending);
    const [uploadUrl] = await this.storage.bucket().file(objectPath).getSignedUrl({
      version: "v4",
      action: "write",
      expires: expiresAt,
      contentType: "application/json"
    });
    return { uploadId, uploadUrl, expiresAt: expiresAt.toISOString() };
  }

  private async writeImmutableRevision(objectPath: string, contents: Buffer, expected: { byteLength: number; sha256: string }): Promise<void> {
    const file = this.storage.bucket().file(objectPath);
    try {
      await file.save(contents, {
        resumable: false,
        contentType: "application/json",
        metadata: { cacheControl: "private, no-store" },
        preconditionOpts: { ifGenerationMatch: 0 }
      });
      return;
    } catch (error) {
      if (!isPreconditionFailure(error)) throw error;
    }
    const [existing] = await file.download();
    if (!cloudObjectMatches(existing, expected)) throw new HttpError(409, "Cloud profile revision already exists with different contents.");
  }

  private async cleanup(uid: string, uploadId: string, objectPaths: string[], now: Date): Promise<void> {
    if (!objectPaths.length) return;
    const remaining: string[] = [];
    for (const objectPath of objectPaths) {
      if (!isSafeCloudRevisionObjectPath(objectPath, uid)) { remaining.push(objectPath); continue; }
      try { await this.storage.bucket().file(objectPath).delete({ ignoreNotFound: true }); }
      catch { remaining.push(objectPath); }
    }
    const ref = this.db.collection("cloudSaveCleanupJobs").doc(uploadId);
    if (remaining.length) await ref.update({ objectPaths: remaining, lastAttemptAt: now.toISOString() }).catch(() => undefined);
    else await ref.delete().catch(() => undefined);
  }

  async finalizeUpload(uid: string, profileId: string, uploadId: string, now: Date): Promise<ReturnType<typeof publicProfile>> {
    await this.requireCloudSave(uid, now);
    const uploadRef = this.db.collection("cloudSaveProfileUploads").doc(uploadId);
    const uploadSnapshot = await uploadRef.get();
    if (!uploadSnapshot.exists) throw new HttpError(404, "Cloud profile upload was not found.");
    const pending = uploadSnapshot.data() as PendingProfileUpload;
    if (pending.uid !== uid) throw new HttpError(403, "Cloud profile upload belongs to another account.");
    if (pending.profileId !== profileId) throw new HttpError(409, "Cloud profile upload does not match this profile.");
    if (pending.state === "complete") {
      const current = await this.profiles(uid).doc(pending.profileId).get();
      if (!current.exists) throw new Error("Completed profile upload is missing its manifest.");
      await this.cleanup(uid, uploadId, pending.cleanupObjectPaths ?? [], now);
      return publicProfile(current.data() as CloudSaveProfileManifest);
    }
    if (Date.parse(pending.expiresAt) < now.getTime()) throw new HttpError(410, "Cloud profile upload expired.");
    const staging = this.storage.bucket().file(pending.objectPath);
    const [exists] = await staging.exists();
    if (!exists) throw new HttpError(409, "Upload the cloud profile before finalizing it.");
    const [contents] = await staging.download();
    if (!cloudObjectMatches(contents, pending)) {
      await staging.delete({ ignoreNotFound: true });
      throw new HttpError(422, "Uploaded cloud profile failed its size or SHA-256 integrity check.");
    }
    validateCloudProfileBundle(contents, pending.profileId);

    const revisionPath = cloudProfileRevisionObjectPath(uid, pending.profileId, pending.uploadId);
    await this.writeImmutableRevision(revisionPath, contents, pending);
    const profileRef = this.profiles(uid).doc(pending.profileId);
    const result = await this.db.runTransaction(async (transaction): Promise<
      { manifest: CloudSaveProfileManifest; cleanupObjectPaths: string[] } | { conflictRevision: string | null }
    > => {
      const [freshUpload, profileSnapshot] = await Promise.all([transaction.get(uploadRef), transaction.get(profileRef)]);
      if (!profileSnapshot.exists) throw new HttpError(404, "Cloud-save profile was not found.");
      const fresh = freshUpload.data() as PendingProfileUpload;
      const current = profileSnapshot.data() as CloudSaveProfileManifest;
      if (fresh.state === "complete") return { manifest: current, cleanupObjectPaths: fresh.cleanupObjectPaths ?? [] };
      const actual = current.currentRevision;
      if (cloudRevisionConflicts(fresh.baseRevision, actual)) {
        transaction.update(uploadRef, { state: "conflict", conflictRevision: actual, updatedAt: now.toISOString() });
        return { conflictRevision: actual };
      }
      const retention = retainedCloudRevisionPlan(current.currentRevision && current.objectPath ? {
        currentRevision: current.currentRevision,
        objectPath: current.objectPath,
        updatedAt: current.updatedAt,
        previousRevisions: current.previousRevisions
      } : undefined);
      const manifest: CloudSaveProfileManifest = {
        ...current,
        updatedAt: now.toISOString(),
        currentRevision: fresh.uploadId,
        objectPath: revisionPath,
        byteLength: fresh.byteLength,
        sha256: fresh.sha256,
        previousRevisions: retention.retained
      };
      transaction.set(profileRef, manifest);
      transaction.update(uploadRef, { state: "complete", completedAt: now.toISOString(), cleanupObjectPaths: retention.prunedObjectPaths });
      if (retention.prunedObjectPaths.length) {
        transaction.set(this.db.collection("cloudSaveCleanupJobs").doc(fresh.uploadId), {
          state: "pending", uid, objectPaths: retention.prunedObjectPaths,
          createdAt: now.toISOString(), attemptCount: 0
        });
      }
      return { manifest, cleanupObjectPaths: retention.prunedObjectPaths };
    });
    if ("conflictRevision" in result) {
      await this.storage.bucket().file(revisionPath).delete({ ignoreNotFound: true }).catch(() => undefined);
      await staging.delete({ ignoreNotFound: true }).catch(() => undefined);
      throw new HttpError(409, `Cloud profile conflict: current revision is ${result.conflictRevision ?? "none"}.`);
    }
    await staging.delete({ ignoreNotFound: true }).catch(() => undefined);
    await this.cleanup(uid, uploadId, result.cleanupObjectPaths, now);
    return publicProfile(result.manifest);
  }

  async downloadUrl(uid: string, profileId: string, now: Date): Promise<{
    downloadUrl: string;
    manifest: ReturnType<typeof publicProfile>;
  }> {
    await this.requireCloudSave(uid, now);
    const snapshot = await this.profiles(uid).doc(profileId).get();
    if (!snapshot.exists) throw new HttpError(404, "Cloud-save profile was not found.");
    const manifest = snapshot.data() as CloudSaveProfileManifest;
    if (!manifest.currentRevision || !manifest.objectPath || !isSafeCloudRevisionObjectPath(manifest.objectPath, uid)) {
      throw new HttpError(404, "This profile has no cloud saves yet.");
    }
    const [downloadUrl] = await this.storage.bucket().file(manifest.objectPath).getSignedUrl({
      version: "v4", action: "read", expires: new Date(now.getTime() + URL_TTL_MS)
    });
    return { downloadUrl, manifest: publicProfile(manifest) };
  }
}
