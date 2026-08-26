import { describe, expect, it } from "vitest";
import { publicCloudSaveSummary } from "../src/admin/operations-service.js";

describe("administrator cloud-save summaries", () => {
  it("shows the retained revision timeline without exposing storage coordinates or account identifiers", () => {
    const result = publicCloudSaveSummary("save1", {
      uid: "private-customer-uid",
      slot: "save1",
      currentRevision: "4acb303f-18d2-4b98-b665-058c332271df",
      objectPath: "cloud-saves/private-customer-uid/slots/save1/revisions/current.json",
      byteLength: 48213,
      sha256: "a".repeat(64),
      updatedAt: "2026-08-26T08:00:00.000Z",
      previousRevisions: [
        {
          revision: "5bcb303f-18d2-4b98-b665-058c332271df",
          objectPath: "cloud-saves/private-customer-uid/slots/save1/revisions/previous.json",
          updatedAt: "2026-08-25T08:00:00.000Z"
        },
        {
          revision: "5bcb303f-18d2-4b98-b665-058c332271df",
          objectPath: "duplicate-must-not-escape",
          updatedAt: "2026-08-24T08:00:00.000Z"
        },
        { revision: "invalid", objectPath: "invalid-must-not-escape", updatedAt: "not-a-date" }
      ]
    });

    expect(result).toEqual({
      id: "save1",
      slot: "save1",
      currentRevision: "4acb303f-18d2-4b98-b665-058c332271df",
      byteLength: 48213,
      sha256: "a".repeat(64),
      updatedAt: "2026-08-26T08:00:00.000Z",
      retainedRevisionCount: 2,
      revisions: [
        { revision: "4acb303f-18d2-4b98-b665-058c332271df", updatedAt: "2026-08-26T08:00:00.000Z", current: true },
        { revision: "5bcb303f-18d2-4b98-b665-058c332271df", updatedAt: "2026-08-25T08:00:00.000Z", current: false }
      ]
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("private-customer-uid");
    expect(serialized).not.toContain("objectPath");
    expect(serialized).not.toContain("cloud-saves/");
  });

  it("fails closed for malformed slot, hash, size, timestamps, and revisions", () => {
    expect(publicCloudSaveSummary("outside", {
      slot: "../../save1",
      currentRevision: "not-a-revision",
      byteLength: -1,
      sha256: "not-a-hash",
      updatedAt: "not-a-date",
      previousRevisions: [{ revision: "also-invalid", updatedAt: "not-a-date" }]
    })).toEqual({
      id: "outside",
      slot: "invalid",
      currentRevision: null,
      byteLength: null,
      sha256: null,
      updatedAt: null,
      retainedRevisionCount: 0,
      revisions: []
    });
  });
});
