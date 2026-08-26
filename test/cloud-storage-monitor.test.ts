import { describe, expect, it } from "vitest";
import {
  runCloudStorageMonitor,
  summarizeCloudStorage,
  type CloudStorageInventorySource,
  type CloudStorageMetricsRepository,
  type CloudStorageSnapshot
} from "../src/monitoring/cloud-storage-monitor.js";

const now = new Date("2026-08-24T12:00:00.000Z");

describe("cloud storage monitoring", () => {
  it("counts immutable and staging bytes and flags only stale staging objects", () => {
    const snapshot = summarizeCloudStorage({
      revisions: [
        { path: "cloud-save-profiles/a/1.json", size: 1000, updatedAt: "2026-08-22T12:00:00.000Z" },
        { path: "cloud-save-profiles/a/2.json", size: 2000, updatedAt: "2026-08-24T11:00:00.000Z" }
      ],
      staging: [
        { path: "cloud-save-profile-uploads/a/fresh.json", size: 300, updatedAt: "2026-08-24T11:00:00.000Z" },
        { path: "cloud-save-profile-uploads/a/stale.json", size: 400, updatedAt: "2026-08-22T11:00:00.000Z" }
      ],
      previous: { totalBytes: 3000 } as CloudStorageSnapshot,
      now,
      dailyGrowthAlertBytes: 500
    });
    expect(snapshot).toMatchObject({
      revisionObjects: 2,
      revisionBytes: 3000,
      stagingObjects: 2,
      stagingBytes: 700,
      staleStagingObjects: 1,
      staleStagingBytes: 400,
      totalObjects: 4,
      totalBytes: 3700,
      dailyChangeBytes: 700,
      growthAlert: true,
      staleUploadAlert: true
    });
  });

  it("lists the two profile-only server prefixes and persists a dated snapshot", async () => {
    const prefixes: string[] = [];
    const source: CloudStorageInventorySource = {
      list: async (prefix) => {
        prefixes.push(prefix);
        return prefix === "cloud-save-profiles/"
          ? [{ path: `${prefix}one.json`, size: 1024, updatedAt: now.toISOString() }]
          : [];
      }
    };
    let saved: CloudStorageSnapshot | undefined;
    const repository: CloudStorageMetricsRepository = {
      previous: async () => undefined,
      save: async (snapshot) => { saved = snapshot; },
      fail: async () => { throw new Error("unexpected failure"); }
    };
    const result = await runCloudStorageMonitor({ source, repository, now, dailyGrowthAlertBytes: 1024 });
    expect(prefixes.sort()).toEqual(["cloud-save-profile-uploads/", "cloud-save-profiles/"]);
    expect(result).toMatchObject({ date: "2026-08-24", totalBytes: 1024, dailyChangeBytes: null, growthAlert: false });
    expect(saved).toEqual(result);
  });

  it("fails closed on malformed provider size metadata", () => {
    expect(() => summarizeCloudStorage({
      revisions: [{ path: "cloud-save-profiles/a/bad.json", size: Number.NaN, updatedAt: now.toISOString() }],
      staging: [],
      now,
      dailyGrowthAlertBytes: 1000
    })).toThrow(/invalid object-size/i);
  });

  it("records only a generic failure state when inventory listing fails", async () => {
    let failures = 0;
    const source: CloudStorageInventorySource = { list: async () => { throw new Error("cloud-save-profiles/private-uid/secret-path"); } };
    const repository: CloudStorageMetricsRepository = {
      previous: async () => undefined,
      save: async () => { throw new Error("unexpected save"); },
      fail: async () => { failures += 1; }
    };
    await expect(runCloudStorageMonitor({ source, repository, now, dailyGrowthAlertBytes: 1024 }))
      .rejects.toThrow(/^Cloud Storage monitoring failed\.$/);
    expect(failures).toBe(1);
  });
});
