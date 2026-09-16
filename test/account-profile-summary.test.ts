import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { CloudSaveProfileService, summarizeProfileSaves } from "../src/cloud-save/profile-service.js";

const payload = (files: Record<string, string>, profileId = "default") => Buffer.from(JSON.stringify({
  magic: "WL_CLOUD_PROFILE", version: 1, profileId, files
}));
describe("account profile save summaries", () => {
  it("lists actual slots, excludes internal metadata, and keeps game-save timestamps separate", () => {
    const content = payload({
      global: JSON.stringify([{ timestamp: 1700000000000, playtime: "01:02:03" }, null, { timestamp: 1700000001000, playtime: "02:03:04" }]),
      file2: "{}", file0: "{}"
    });
    expect(summarizeProfileSaves(content, "default")).toEqual([
      {slot: 0, savedAt: "2023-11-14T22:13:20.000Z", playtime: "01:02:03"},
      {slot: 2, savedAt: "2023-11-14T22:13:21.000Z", playtime: "02:03:04"}
    ]);
  });
  it("does not invent metadata when timestamps are missing or malformed", () => {
    expect(summarizeProfileSaves(payload({global:'[null,{"timestamp":1e30,"playtime":"<script>"}]',file1:"{}"}), "default"))
      .toEqual([{slot:1,savedAt:null,playtime:null}]);
    expect(summarizeProfileSaves(payload({global:"invalid",file1:"{}"}),"default")[0]?.savedAt).toBeNull();
  });
  it("rejects a different profile and invalid files", () => {
    expect(() => summarizeProfileSaves(payload({global:"[]",file1:"{}"}, "other"),"default")).toThrow();
    expect(() => summarizeProfileSaves(payload({global:"[]",secret:"{}"}),"default")).toThrow();
  });
  it("reads an old bundle using only the authenticated user's profile path", async () => {
    const bytes = payload({global:"[]",file1:"{}"});
    const manifest = {uid:"owner",profileId:"default",name:"French",currentRevision:"11111111-1111-4111-8111-111111111111",
      objectPath:"cloud-save-profiles/owner/profiles/default/revisions/11111111-1111-4111-8111-111111111111.json",
      byteLength:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),previousRevisions:[]};
    const chain = {doc:vi.fn(),collection:vi.fn(),get:vi.fn(async()=>({exists:true,data:()=>manifest}))};
    chain.doc.mockReturnValue(chain);chain.collection.mockReturnValue(chain);
    const file = {getMetadata:vi.fn(async()=>[{size:bytes.length}]),download:vi.fn(async()=>[bytes])};
    const storage = {bucket:()=>({file:vi.fn(()=>file)})};
    const entitlements = {effectiveEntitlements:vi.fn(async()=>({cloudSave:true,premiumLifetime:true}))};
    const service = new CloudSaveProfileService(chain as never,storage as never,entitlements as never);
    const result = await service.summary("owner","default",new Date());
    expect(chain.doc.mock.calls).toEqual([["owner"],["default"]]);
    expect(result.saves).toEqual([{slot:1,savedAt:null,playtime:null}]);
    expect(result).not.toHaveProperty("objectPath");
    expect(result).not.toHaveProperty("uid");
    manifest.objectPath = manifest.objectPath.replace("/owner/","/other/");
    await expect(service.summary("owner","default",new Date())).rejects.toThrow();
    entitlements.effectiveEntitlements.mockResolvedValue({cloudSave:false,premiumLifetime:false});
    await expect(service.summary("owner","default",new Date())).rejects.toThrow();
  });
});
