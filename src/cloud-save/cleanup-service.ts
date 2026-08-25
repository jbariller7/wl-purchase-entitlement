import { randomUUID } from "node:crypto";
import { FieldValue, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";

const LEASE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const REVISION_PATH = /^cloud-saves\/[^/]{1,128}\/slots\/save(?:0|[1-9]|1[0-9]|20)\/revisions\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/i;

export interface CloudSaveCleanupJob {
  state: "pending" | "processing" | "failed";
  uid: string;
  objectPaths: string[];
  createdAt: string;
  attemptCount: number;
  notBefore?: string;
  leaseOwner?: string;
  leaseUntil?: string;
  lastError?: string;
  lastAttemptAt?: string;
}

export function isSafeCloudRevisionObjectPath(value: string, expectedUid?: string): boolean {
  if (value.length > 512 || !REVISION_PATH.test(value)) return false;
  return !expectedUid || value.split("/")[1] === expectedUid;
}

export function cloudSaveCleanupRetryAt(attemptCount: number, now: Date): string {
  const exponent = Math.max(0, Math.min(9, Math.trunc(attemptCount) - 1));
  const delayMs = Math.min(6 * 60 * 60 * 1000, 30_000 * (2 ** exponent));
  return new Date(now.getTime() + delayMs).toISOString();
}

function timestamp(value: unknown): number {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export class CloudSaveCleanupService {
  constructor(private readonly db: Firestore, private readonly storage: Storage) {}

  private async candidates(limit: number): Promise<QueryDocumentSnapshot[]> {
    const collection = this.db.collection("cloudSaveCleanupJobs");
    const [pending, processing] = await Promise.all([
      collection.where("state", "==", "pending").limit(limit).get(),
      collection.where("state", "==", "processing").limit(limit).get()
    ]);
    return [...new Map([...pending.docs, ...processing.docs].map((doc) => [doc.id, doc])).values()]
      .sort((a, b) => timestamp(a.get("createdAt")) - timestamp(b.get("createdAt")))
      .slice(0, limit);
  }

  private async lease(jobId: string, workerId: string, now: Date): Promise<CloudSaveCleanupJob | undefined> {
    const ref = this.db.collection("cloudSaveCleanupJobs").doc(jobId);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return undefined;
      const job = snapshot.data() as CloudSaveCleanupJob;
      if (job.state === "failed") return undefined;
      if (timestamp(job.notBefore) > now.getTime()) return undefined;
      if (job.state === "processing" && timestamp(job.leaseUntil) > now.getTime()) return undefined;
      if (!job.uid || !Array.isArray(job.objectPaths) || !job.objectPaths.length || job.objectPaths.length > 4) {
        transaction.update(ref, {
          state: "failed",
          lastError: "Cleanup job contained an invalid object-path set.",
          lastAttemptAt: now.toISOString(),
          leaseOwner: FieldValue.delete(),
          leaseUntil: FieldValue.delete()
        });
        return undefined;
      }
      transaction.update(ref, {
        state: "processing",
        leaseOwner: workerId,
        leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString(),
        lastAttemptAt: now.toISOString()
      });
      return job;
    });
  }

  async run(now: Date, limit = 25): Promise<{ scanned: number; deleted: number; failed: number; skipped: number }> {
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const workerId = randomUUID();
    const candidates = await this.candidates(boundedLimit);
    let deleted = 0;
    let failed = 0;
    let skipped = 0;
    for (const candidate of candidates) {
      const job = await this.lease(candidate.id, workerId, now);
      if (!job) { skipped += 1; continue; }
      const ref = this.db.collection("cloudSaveCleanupJobs").doc(candidate.id);
      try {
        if (!job.objectPaths.every((objectPath) => isSafeCloudRevisionObjectPath(objectPath, job.uid))) {
          throw new Error("Cleanup job contained an unsafe object path.");
        }
        for (const objectPath of job.objectPaths) {
          await this.storage.bucket().file(objectPath).delete({ ignoreNotFound: true });
        }
        await ref.delete();
        deleted += job.objectPaths.length;
      } catch (error) {
        const attemptCount = Number(job.attemptCount || 0) + 1;
        const unsafePath = error instanceof Error && error.message === "Cleanup job contained an unsafe object path.";
        const terminal = unsafePath || attemptCount >= MAX_ATTEMPTS;
        const safeMessage = unsafePath
          ? error.message
          : "Cloud Storage revision deletion failed.";
        await ref.update({
          state: terminal ? "failed" : "pending",
          attemptCount,
          notBefore: terminal ? FieldValue.delete() : cloudSaveCleanupRetryAt(attemptCount, now),
          lastError: safeMessage,
          lastAttemptAt: now.toISOString(),
          leaseOwner: FieldValue.delete(),
          leaseUntil: FieldValue.delete()
        });
        console.error("Cloud-save revision cleanup failed", {
          jobId: candidate.id,
          attemptCount,
          terminal,
          error: safeMessage
        });
        failed += 1;
      }
    }
    return { scanned: candidates.length, deleted, failed, skipped };
  }
}
