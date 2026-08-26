import { FieldPath, type Firestore } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";

const STALE_STAGING_MS = 24 * 60 * 60 * 1000;

export interface CloudStorageObject {
  path: string;
  size: number;
  updatedAt: string;
}

export interface CloudStorageInventorySource {
  list(prefix: string): Promise<CloudStorageObject[]>;
}

export interface CloudStorageSnapshot {
  date: string;
  capturedAt: string;
  revisionObjects: number;
  revisionBytes: number;
  stagingObjects: number;
  stagingBytes: number;
  staleStagingObjects: number;
  staleStagingBytes: number;
  totalObjects: number;
  totalBytes: number;
  dailyChangeBytes: number | null;
  growthAlert: boolean;
  staleUploadAlert: boolean;
}

export interface CloudStorageMetricsRepository {
  previous(date: string): Promise<CloudStorageSnapshot | undefined>;
  save(snapshot: CloudStorageSnapshot): Promise<void>;
  fail(now: Date): Promise<void>;
}

function finiteBytes(value: unknown): number {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("Cloud Storage returned invalid object-size metadata.");
  return size;
}

export class FirebaseStorageInventorySource implements CloudStorageInventorySource {
  constructor(private readonly storage: Storage) {}

  async list(prefix: string): Promise<CloudStorageObject[]> {
    const [listed] = await this.storage.bucket().getFiles({ prefix });
    // firebase-admin currently exposes different File metadata types depending
    // on the resolved @google-cloud/storage version. Normalize that SDK
    // boundary here and validate every value before using it.
    const files = listed as unknown as Array<{
      name: string;
      metadata: { size?: unknown; updated?: unknown; timeCreated?: unknown };
      getMetadata(): Promise<[{ size?: unknown; updated?: unknown; timeCreated?: unknown }]>;
    }>;
    return Promise.all(files.filter((file) => !file.name.endsWith("/")).map(async (file) => {
      let metadata: { size?: unknown; updated?: unknown; timeCreated?: unknown } = file.metadata;
      if (metadata.size === undefined || !metadata.updated) {
        const [freshMetadata] = await file.getMetadata();
        metadata = freshMetadata;
      }
      const updatedAt = typeof metadata.updated === "string"
        ? metadata.updated
        : typeof metadata.timeCreated === "string" ? metadata.timeCreated : "1970-01-01T00:00:00.000Z";
      return { path: file.name, size: finiteBytes(metadata.size), updatedAt };
    }));
  }
}

export class FirestoreCloudStorageMetricsRepository implements CloudStorageMetricsRepository {
  constructor(private readonly db: Firestore) {}

  async previous(date: string): Promise<CloudStorageSnapshot | undefined> {
    const snapshot = await this.db.collection("cloudStorageSnapshots")
      .where(FieldPath.documentId(), "<", date)
      .orderBy(FieldPath.documentId(), "desc")
      .limit(1)
      .get();
    return snapshot.empty ? undefined : snapshot.docs[0]?.data() as CloudStorageSnapshot;
  }

  async save(snapshot: CloudStorageSnapshot): Promise<void> {
    const batch = this.db.batch();
    batch.set(this.db.collection("cloudStorageSnapshots").doc(snapshot.date), snapshot);
    batch.set(this.db.collection("operationalMetrics").doc("cloudStorage"), snapshot);
    batch.set(this.db.collection("operationalMetrics").doc("cloudStorageMonitor"), {
      state: "succeeded",
      lastSucceededAt: snapshot.capturedAt,
      lastError: null
    }, { merge: true });
    await batch.commit();
  }

  async fail(now: Date): Promise<void> {
    await this.db.collection("operationalMetrics").doc("cloudStorageMonitor").set({
      state: "failed",
      lastFailedAt: now.toISOString(),
      // Never retain SDK error text: it can contain a bucket path with UID.
      lastError: "Cloud Storage inventory request failed. Review the Netlify function status and Firebase IAM/billing configuration."
    }, { merge: true });
  }
}

export function summarizeCloudStorage(input: {
  revisions: CloudStorageObject[];
  staging: CloudStorageObject[];
  previous?: CloudStorageSnapshot;
  now: Date;
  dailyGrowthAlertBytes: number;
}): CloudStorageSnapshot {
  const sum = (objects: CloudStorageObject[]): number => objects.reduce((total, object) => total + finiteBytes(object.size), 0);
  const staleCutoff = input.now.getTime() - STALE_STAGING_MS;
  const staleStaging = input.staging.filter((object) => {
    const updatedAt = Date.parse(object.updatedAt);
    return !Number.isFinite(updatedAt) || updatedAt < staleCutoff;
  });
  const revisionBytes = sum(input.revisions);
  const stagingBytes = sum(input.staging);
  const totalBytes = revisionBytes + stagingBytes;
  const dailyChangeBytes = input.previous ? totalBytes - input.previous.totalBytes : null;
  return {
    date: input.now.toISOString().slice(0, 10),
    capturedAt: input.now.toISOString(),
    revisionObjects: input.revisions.length,
    revisionBytes,
    stagingObjects: input.staging.length,
    stagingBytes,
    staleStagingObjects: staleStaging.length,
    staleStagingBytes: sum(staleStaging),
    totalObjects: input.revisions.length + input.staging.length,
    totalBytes,
    dailyChangeBytes,
    growthAlert: dailyChangeBytes !== null && dailyChangeBytes > input.dailyGrowthAlertBytes,
    staleUploadAlert: staleStaging.length > 0
  };
}

export async function runCloudStorageMonitor(input: {
  source: CloudStorageInventorySource;
  repository: CloudStorageMetricsRepository;
  now?: Date;
  dailyGrowthAlertBytes: number;
}): Promise<CloudStorageSnapshot> {
  const now = input.now ?? new Date();
  try {
    const [legacyRevisions, legacyStaging, profileRevisions, profileStaging] = await Promise.all([
      input.source.list("cloud-saves/"),
      input.source.list("cloud-save-uploads/"),
      input.source.list("cloud-save-profiles/"),
      input.source.list("cloud-save-profile-uploads/")
    ]);
    const revisions = [...legacyRevisions, ...profileRevisions];
    const staging = [...legacyStaging, ...profileStaging];
    const date = now.toISOString().slice(0, 10);
    const previous = await input.repository.previous(date);
    const snapshot = summarizeCloudStorage({
      revisions,
      staging,
      ...(previous ? { previous } : {}),
      now,
      dailyGrowthAlertBytes: input.dailyGrowthAlertBytes
    });
    await input.repository.save(snapshot);
    return snapshot;
  } catch {
    await input.repository.fail(now).catch(() => undefined);
    throw new Error("Cloud Storage monitoring failed.");
  }
}
