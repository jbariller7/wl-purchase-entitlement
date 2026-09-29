import { describe, expect, it, vi } from "vitest";
import { AdminImportService, type AdminImportRow } from "../src/admin/import-service.js";
import { EntitlementStore } from "../src/infrastructure/entitlement-store.js";

const actor = { uid: "owner", email: "owner@example.com" };
const now = new Date("2026-09-29T10:00:00Z");
const rows = (n: number): AdminImportRow[] => Array.from({ length: n }, (_, i) => ({
  email: `holder${i}@example.com`, kind: "premium_lifetime_pass", mobilePlatform: "android",
  externalId: `lifetime-${i}`, note: "Historical lifetime access"
}));

function fixture() {
  const docs = new Map<string, any>();
  let failCheckpoint = false;
  const ref = (path: string) => ({ id: path.split("/").at(-1), path,
    get: async () => snap(path), create: async (data: any) => { docs.set(path, structuredClone(data)); },
    update: async (data: any) => { docs.set(path, { ...docs.get(path), ...structuredClone(data) }); }
  });
  const snap = (path: string) => ({ id: path.split("/").at(-1), exists: docs.has(path), data: () => structuredClone(docs.get(path)) });
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`),
      orderBy: () => ({ limit: (n: number) => ({ get: async () => ({ docs: [...docs.keys()].filter(k => k.startsWith(`${name}/`)).slice(0,n).map(snap) }) }) }) }),
    runTransaction: async (fn: any) => {
      const writes: (() => void)[] = [];
      const result = await fn({ get: async (r: any) => snap(r.path),
        set: (r: any, data: any) => writes.push(() => docs.set(r.path, structuredClone(data))),
        update: (r: any, data: any) => {
          if (failCheckpoint && Object.keys(data).length === 3 && data.processed) { failCheckpoint = false; throw new Error("Connection lost after row write"); }
          writes.push(() => docs.set(r.path, { ...docs.get(r.path), ...structuredClone(data) }));
        }
      });
      writes.forEach(w => w()); return result;
    }
  };
  const auth = {
    getUsers: vi.fn(async () => ({ users: [] })),
    getUserByEmail: vi.fn(async (_email: string): Promise<any> => { throw Object.assign(new Error("No account"), { code: "auth/user-not-found" }); })
  };
  const service = new AdminImportService(db as never, auth as never);
  const preview = async (n = 12) => service.preview({ actor, rows: rows(n), now });
  const commit = (p: any, at = now) => service.commit({ actor, previewId: p.previewId, confirmationPhrase: p.confirmationPhrase, now: at });
  return { docs, auth, service, preview, commit, failNextCheckpoint: () => { failCheckpoint = true; } };
}

describe("resumable administrator imports", () => {
  it("checkpoints batches, completes all rows and audits completion once", async () => {
    const f = fixture(); const p = await f.preview();
    expect(await f.commit(p)).toMatchObject({ processed: 5, pending: 5, state: "processing" });
    expect(await f.commit(p)).toMatchObject({ processed: 10, pending: 10 });
    expect(await f.commit(p)).toMatchObject({ processed: 12, records: 12, pending: 12, state: "complete" });
    expect(await f.commit(p)).toMatchObject({ processed: 12, pending: 12, state: "complete" });
    expect([...f.docs.keys()].filter(k => k.startsWith("pendingImports/"))).toHaveLength(12);
    expect([...f.docs.keys()].filter(k => k.startsWith("adminAudit/"))).toHaveLength(1);
    expect(f.auth.getUserByEmail).toHaveBeenCalledTimes(12);
  });
  it("replays a row written before a lost checkpoint without duplicating pending access", async () => {
    const f = fixture(); const p = await f.preview(2); f.failNextCheckpoint();
    await expect(f.commit(p)).rejects.toThrow("Connection lost");
    expect(await f.commit(p)).toMatchObject({ state: "complete", pending: 2, processed: 2 });
    const pending = [...f.docs.entries()].filter(([k]) => k.startsWith("pendingImports/"));
    expect(pending).toHaveLength(2);
    for (const [,value] of pending) expect(value.rows).toHaveLength(1);
  });
  it("uses identical grant identifiers and original dates when replaying an applied row", async () => {
    const f = fixture(); const p = await f.preview(1);
    f.auth.getUserByEmail.mockResolvedValue({ uid: "member" });
    const writes = vi.spyOn(EntitlementStore.prototype, "upsertGrant").mockResolvedValue(true);
    f.failNextCheckpoint();
    try {
      await expect(f.commit(p)).rejects.toThrow("Connection lost");
      expect(await f.commit(p)).toMatchObject({ applied: 1, pending: 0, state: "complete" });
      expect(writes).toHaveBeenCalledTimes(2);
      expect(writes.mock.calls[0]).toEqual(writes.mock.calls[1]);
      expect(writes.mock.calls[0]?.[0]).toMatchObject({ providerTransactionId: "import:lifetime-0", startsAt: now.toISOString() });
    } finally { writes.mockRestore(); }
  });
  it("recovers an old timed-out import after preview expiry, with no cursor", async () => {
    const f = fixture(); const p = await f.preview(3); const key = `adminImportPreviews/${p.previewId}`;
    Object.assign(f.docs.get(key), { state: "processing", processingAt: now.toISOString() });
    expect(await f.commit(p, new Date(now.getTime() + 3_600_000))).toMatchObject({ state: "complete", pending: 3 });
  });
  it("does not compete with a live legacy request or another lease", async () => {
    const f = fixture(); const p = await f.preview(1); const job = f.docs.get(`adminImportPreviews/${p.previewId}`);
    Object.assign(job, { state: "processing", processingAt: now.toISOString() });
    expect(await f.commit(p)).toMatchObject({ busy: true, processed: 0 });
    Object.assign(job, { leaseOwner: "other", leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString() });
    expect(await f.commit(p)).toMatchObject({ busy: true });
    expect(f.auth.getUserByEmail).not.toHaveBeenCalled();
    expect(await f.commit(p, new Date(now.getTime() + 121_000))).toMatchObject({ state: "complete" });
  });
  it("keeps checkpoint counts when recovering an expired worker lease", async () => {
    const f = fixture(); const p = await f.preview(8); await f.commit(p);
    Object.assign(f.docs.get(`adminImportPreviews/${p.previewId}`), { leaseOwner: "dead-worker", leaseExpiresAt: now.toISOString() });
    expect(await f.commit(p, new Date(now.getTime() + 3_600_000))).toMatchObject({ state: "complete", processed: 8, pending: 8 });
    expect(f.auth.getUserByEmail).toHaveBeenCalledTimes(8);
  });
  it("rejects expired unconfirmed previews and incorrect confirmation", async () => {
    const f = fixture(); const p = await f.preview(1);
    await expect(f.commit({ ...p, confirmationPhrase: "wrong" })).rejects.toThrow("does not match");
    await expect(f.commit(p, new Date(now.getTime() + 3_600_000))).rejects.toThrow("expired");
    expect(f.auth.getUserByEmail).not.toHaveBeenCalled();
  });
  it("does not let another administrator inspect or resume the import", async () => {
    const f = fixture(); const p = await f.preview(1); const other = { ...actor, uid: "other" };
    await expect(f.service.status(other, p.previewId as string)).rejects.toThrow("another administrator");
    await expect(f.service.commit({ actor: other, previewId: p.previewId as string, confirmationPhrase: p.confirmationPhrase as string, now })).rejects.toThrow("another administrator");
    expect(await f.service.recent(other)).toEqual({ imports: [] });
  });
  it("stops on auth failures rather than classifying existing accounts as missing", async () => {
    const f = fixture(); const p = await f.preview(6); await f.commit(p);
    f.auth.getUserByEmail.mockRejectedValue(new Error("Authentication service unavailable"));
    await expect(f.commit(p)).rejects.toThrow("unavailable");
    expect(await f.service.status(actor, p.previewId as string)).toMatchObject({ state: "failed", processed: 5, pending: 5 });
  });
  it("resolves a 500-row preview in five bounded Auth calls", async () => {
    const f = fixture(); const p = await f.preview(500);
    expect(p.summary).toMatchObject({ records: 500, pendingFirstSignIn: 500 });
    expect(f.auth.getUsers).toHaveBeenCalledTimes(5);
    expect(f.auth.getUserByEmail).not.toHaveBeenCalled();
  });
});
