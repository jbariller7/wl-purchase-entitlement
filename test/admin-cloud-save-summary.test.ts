import { describe, expect, it } from "vitest";
import { publicCloudProfileSummary } from "../src/admin/operations-service.js";

describe("administrator cloud-profile summaries", () => {
  it("shows a named complete profile without exposing account or Storage coordinates", () => {
    const result = publicCloudProfileSummary("default", {
      uid: "private-customer-uid",
      profileId: "default",
      name: "Japanese",
      currentRevision: "4acb303f-18d2-4b98-b665-058c332271df",
      objectPath: "cloud-save-profiles/private-customer-uid/profiles/default/revisions/private.json",
      byteLength: 90000,
      sha256: "b".repeat(64),
      createdAt: "2026-08-25T08:00:00.000Z",
      updatedAt: "2026-08-26T08:00:00.000Z",
      previousRevisions: []
    });
    expect(result).toMatchObject({
      profileId: "default",
      name: "Japanese",
      byteLength: 90000,
      retainedRevisionCount: 1
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("private-customer-uid");
    expect(serialized).not.toContain("objectPath");
    expect(serialized).not.toContain("cloud-save-profiles/");
  });
});
