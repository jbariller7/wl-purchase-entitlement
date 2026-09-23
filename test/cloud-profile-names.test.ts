import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";
import type { EntitlementStore } from "../src/infrastructure/entitlement-store.js";
import { CloudSaveProfileService, cloudProfileNameKey } from "../src/cloud-save/profile-service.js";

function fixture() {
  const records = new Map<string, Record<string, any>>();
  const ref = (path: string): any => ({ path, collection: (name: string) => collection(`${path}/${name}`),
    get: async () => ({ exists: records.has(path), data: () => records.get(path) }) });
  const collection = (path: string): any => ({ path, doc: (id: string) => ref(`${path}/${id}`), limit: () => collection(path),
    get: async () => {
      const docs = [...records].filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/"))
        .map(([key, value]) => ({ id: key.split("/").at(-1), data: () => value }));
      return { docs, size: docs.length, empty: !docs.length };
    } });
  let queue = Promise.resolve();
  const db = { collection, runTransaction: (callback: any) => {
    const result = queue.then(async () => {
      const reads: string[] = []; const writes: Array<() => void> = [];
      const result = await callback({
        get: async (target: any) => { if (writes.length) throw Error("Read after write"); reads.push(target.path); return target.get(); },
        create: (target: any, value: any) => writes.push(() => { if (records.has(target.path)) throw Error("Exists"); records.set(target.path, value); }),
        set: (target: any, value: any, options?: any) => writes.push(() => records.set(target.path, options?.merge ? { ...records.get(target.path), ...value } : value))
      });
      if (writes.length) expect(reads[0]).toMatch(/^cloudSaves\/[^/]+$/);
      writes.forEach(write => write());
      return result;
    });
    queue = result.then(() => undefined, () => undefined);
    return result;
  } };
  const entitlements = { effectiveEntitlements: async () => ({ cloudSave: true, premiumLifetime: true }) } as unknown as EntitlementStore;
  return new CloudSaveProfileService(db as unknown as Firestore, {} as Storage, entitlements);
}
const now = new Date("2026-09-23T08:00:00Z");

describe("account-scoped unique profile names", () => {
  it("rejects duplicate names on create, including default and Unicode/spacing variants", async () => {
    const service = fixture();
    await expect(service.create("u1", " DEFAULT ", now)).rejects.toThrow("already exists");
    await service.create("u1", "My PC", now);
    await expect(service.create("u1", "my  pc", now)).rejects.toThrow("already exists");
    await expect(service.create("u1", "Ｍｙ PC", now)).rejects.toThrow("already exists");
    expect(cloudProfileNameKey("Cle\u0301ment")).toBe(cloudProfileNameKey("Clément"));
    await expect(service.create("u2", "My PC", now)).resolves.toMatchObject({ name: "My PC" });
  });
  it("rejects renaming to another profile's name but permits the same profile's case change", async () => {
    const service = fixture();
    const pc = await service.create("u1", "PC", now);
    await expect(service.rename("u1", pc.profileId, "default", now)).rejects.toThrow("already exists");
    await expect(service.rename("u1", pc.profileId, "pc", now)).resolves.toMatchObject({ name: "pc" });
    expect((await service.list("u1", now)).map(p => p.name)).toEqual(["Default", "pc"]);
  });
  it("serializes competing device creates and renames on the account registry", async () => {
    const service = fixture();
    const results = await Promise.allSettled([service.create("u1", "Android", now), service.create("u1", "android", now)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const pc = await service.create("u1", "PC", now);
    const races = await Promise.allSettled([service.rename("u1", pc.profileId, "Shared", now), service.create("u1", "SHARED", now)]);
    expect(races.filter(r => r.status === "fulfilled")).toHaveLength(1);
  });
});
