import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http/auth.js";
import {
  cloudProfileRevisionObjectPath,
  cloudSaveProfileIdSchema,
  validateCloudProfileBundle
} from "../src/cloud-save/profile-service.js";
import { isSafeCloudRevisionObjectPath } from "../src/cloud-save/cleanup-service.js";

const profileId = "4acb303f-18d2-4b98-b665-058c332271df";
const revisionId = "5bcb303f-18d2-4b98-b665-058c332271df";

function bundle(files: Record<string, string> = { global: "[]", file1: "{}" }): Buffer {
  return Buffer.from(JSON.stringify({ magic: "WL_CLOUD_PROFILE", version: 1, profileId, files }));
}

describe("whole-profile cloud saves", () => {
  it("accepts the deterministic default and opaque generated profile IDs", () => {
    expect(cloudSaveProfileIdSchema.parse("default")).toBe("default");
    expect(cloudSaveProfileIdSchema.parse(profileId)).toBe(profileId);
    expect(cloudSaveProfileIdSchema.safeParse("../other-user").success).toBe(false);
  });

  it("requires global.rmmzsave data and only accepts the complete RPG Maker save namespace", () => {
    expect(() => validateCloudProfileBundle(bundle(), profileId)).not.toThrow();
    expect(() => validateCloudProfileBundle(bundle({ file1: "{}" }), profileId)).toThrow(HttpError);
    expect(() => validateCloudProfileBundle(bundle({ global: "[]", config: "{}" }), profileId)).toThrow(HttpError);
    expect(() => validateCloudProfileBundle(bundle({ global: "[]", file21: "{}" }), profileId)).toThrow(HttpError);
  });

  it("rejects a bundle copied to another profile", () => {
    expect(() => validateCloudProfileBundle(bundle(), "default")).toThrow(HttpError);
  });

  it("allows cleanup only for account-bound immutable profile revisions", () => {
    const path = cloudProfileRevisionObjectPath("user-1", profileId, revisionId);
    expect(isSafeCloudRevisionObjectPath(path, "user-1")).toBe(true);
    expect(isSafeCloudRevisionObjectPath(path, "user-2")).toBe(false);
    expect(isSafeCloudRevisionObjectPath(path.replace("/revisions/", "/../../"), "user-1")).toBe(false);
  });
});
