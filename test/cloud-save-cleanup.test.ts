import { afterEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";
import { CloudSaveCleanupService } from "../src/cloud-save/cleanup-service.js";

type Row = Record<string, unknown>;

class FakeSnapshot {
  constructor(readonly id: string, private readonly rows: Map<string, Row>) {}
  get exists(): boolean { return this.rows.has(this.id); }
  data(): Row | undefined { return this.rows.get(this.id); }
  get(field: string): unknown { return this.rows.get(this.id)?.[field]; }
}

class FakeDocumentReference {
  constructor(readonly id: string, private readonly rows: Map<string, Row>) {}
  async get(): Promise<FakeSnapshot> { return new FakeSnapshot(this.id, this.rows); }
  async update(patch: Row): Promise<void> {
    const current = this.rows.get(this.id);
    if (!current) throw new Error("missing document");
    this.rows.set(this.id, { ...current, ...patch });
  }
  async delete(): Promise<void> { this.rows.delete(this.id); }
}

class FakeQuery {
  private max = 100;
  constructor(private readonly rows: Map<string, Row>, private readonly state: string) {}
  limit(value: number): this { this.max = value; return this; }
  async get(): Promise<{ docs: FakeSnapshot[] }> {
    return {
      docs: [...this.rows.entries()]
        .filter(([, row]) => row.state === this.state)
        .slice(0, this.max)
        .map(([id]) => new FakeSnapshot(id, this.rows))
    };
  }
}

class FakeCollection {
  constructor(private readonly rows: Map<string, Row>) {}
  doc(id: string): FakeDocumentReference { return new FakeDocumentReference(id, this.rows); }
  where(field: string, operator: string, value: string): FakeQuery {
    if (field !== "state" || operator !== "==") throw new Error("unexpected query");
    return new FakeQuery(this.rows, value);
  }
}

function fakeFirestore(rows: Map<string, Row>): Firestore {
  const collection = new FakeCollection(rows);
  return {
    collection: (name: string) => {
      if (name !== "cloudSaveCleanupJobs") throw new Error("unexpected collection");
      return collection;
    },
    runTransaction: async <T>(callback: (transaction: {
      get: (ref: FakeDocumentReference) => Promise<FakeSnapshot>;
      update: (ref: FakeDocumentReference, patch: Row) => void;
    }) => Promise<T>) => callback({
      get: (ref) => ref.get(),
      update: (ref, patch) => { void ref.update(patch); }
    })
  } as unknown as Firestore;
}

function fakeStorage(deleted: string[], failure?: Error): Storage {
  return {
    bucket: () => ({
      file: (path: string) => ({
        delete: async () => {
          deleted.push(path);
          if (failure) throw failure;
        }
      })
    })
  } as unknown as Storage;
}

const now = new Date("2026-08-25T10:00:00.000Z");
const safePath = "cloud-saves/user-1/slots/save1/revisions/4acb303f-18d2-4b98-b665-058c332271df.json";

function job(overrides: Row = {}): Row {
  return {
    state: "pending",
    uid: "user-1",
    objectPaths: [safePath],
    createdAt: "2026-08-25T09:00:00.000Z",
    attemptCount: 0,
    ...overrides
  };
}

afterEach(() => vi.restoreAllMocks());

describe("cloud-save revision cleanup worker", () => {
  it("deletes only an account-bound immutable revision and removes the durable job", async () => {
    const rows = new Map([["job-1", job()]]);
    const deleted: string[] = [];
    const result = await new CloudSaveCleanupService(fakeFirestore(rows), fakeStorage(deleted)).run(now);
    expect(result).toEqual({ scanned: 1, deleted: 1, failed: 0, skipped: 0 });
    expect(deleted).toEqual([safePath]);
    expect(rows.has("job-1")).toBe(false);
  });

  it("fails a cross-account path closed without touching Cloud Storage", async () => {
    const crossAccount = safePath.replace("user-1", "user-2");
    const rows = new Map([["job-1", job({ objectPaths: [crossAccount] })]]);
    const deleted: string[] = [];
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await new CloudSaveCleanupService(fakeFirestore(rows), fakeStorage(deleted)).run(now);
    expect(result).toEqual({ scanned: 1, deleted: 0, failed: 1, skipped: 0 });
    expect(deleted).toEqual([]);
    expect(rows.get("job-1")).toMatchObject({
      state: "failed",
      attemptCount: 1,
      lastError: "Cleanup job contained an unsafe object path."
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(crossAccount);
  });

  it("retries a provider failure with a sanitized error and exponential delay", async () => {
    const rows = new Map([["job-1", job()]]);
    const deleted: string[] = [];
    const secretProviderError = new Error(`permission denied for ${safePath}`);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await new CloudSaveCleanupService(fakeFirestore(rows), fakeStorage(deleted, secretProviderError)).run(now);
    expect(result).toEqual({ scanned: 1, deleted: 0, failed: 1, skipped: 0 });
    expect(rows.get("job-1")).toMatchObject({
      state: "pending",
      attemptCount: 1,
      notBefore: "2026-08-25T10:00:30.000Z",
      lastError: "Cloud Storage revision deletion failed."
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(safePath);
  });
});
