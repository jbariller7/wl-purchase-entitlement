import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
const source = readFileSync(new URL("../integrations/rmmz/WonderLangAccountCloudSync.js", import.meta.url), "utf8");
const recovery = source.slice(source.indexOf("  function canSaveLocalAsNewProfile"), source.indexOf("  function showSaveLocalAsNewProfile"));

function fixture(access = true, saves = true) {
  const events: string[] = [];
  const profile = { profileId: "default", name: "Default", currentRevision: "confirmed-revision" };
  const panels: any[] = [];
  const activate = vi.fn(async () => { events.push("activate"); });
  const context = {
    canSyncCloud: () => access, hasLocalPlayerSaves: () => saves, accountUid: () => "u1",
    workspaceBinding: () => ({ uid: "u1", profileId: "other", profileName: "Default" }),
    buildProfileBundle: async () => { events.push("bundle"); return { files: { global: "[]", file1: "progress" } }; },
    StorageManager: { saveObject: vi.fn(async () => { events.push("backup"); }) },
    tr: (_key: string, fallback: string) => fallback, trSource: (s: string) => s, escapeHtml: (s: string) => s,
    listProfiles: async () => [profile], openCloudSavesPanel: vi.fn(),
    showPanel: (...args: any[]) => panels.push(args), activateProfile: activate, showError: vi.fn()
  };
  const api = runInNewContext(`${recovery}; ({canSaveLocalAsNewProfile, canSaveLocalToExistingProfile, showSaveLocalToExistingProfile})`, context);
  return { api, context, events, panels, activate, profile };
}

describe("safe local-save recovery", () => {
  it("keeps recovery available even when local files already have a valid owner", () => {
    const { api } = fixture();
    expect(api.canSaveLocalAsNewProfile([{ profileId: "other" }])).toBe(true);
    expect(api.canSaveLocalAsNewProfile(Array(6).fill({}))).toBe(false);
    expect(api.canSaveLocalToExistingProfile(Array(6).fill({}))).toBe(true);
    expect(fixture(false).api.canSaveLocalToExistingProfile([{}])).toBe(false);
    expect(fixture(true, false).api.canSaveLocalAsNewProfile([])).toBe(false);
  });
  it("requires destination and confirmation, then backs up before uploading without downloading", async () => {
    const f = fixture();
    await f.api.showSaveLocalToExistingProfile();
    expect(f.activate).not.toHaveBeenCalled();
    f.panels[0][2][0].run();
    expect(f.activate).not.toHaveBeenCalled();
    const confirm = f.panels[1][2][0].run;
    await Promise.all([confirm(), confirm()]);
    expect(f.events).toEqual(["bundle", "backup", "activate"]);
    expect(f.activate).toHaveBeenCalledExactlyOnceWith(f.profile, "device");
    expect(f.profile.currentRevision).toBe("confirmed-revision");
  });
  it("does not upload if the local recovery copy fails or the account changes", async () => {
    const f = fixture();
    f.context.StorageManager.saveObject.mockRejectedValueOnce(Error("disk full"));
    await f.api.showSaveLocalToExistingProfile(); f.panels[0][2][0].run();
    await f.panels[1][2][0].run();
    expect(f.activate).not.toHaveBeenCalled();
    expect(f.context.showError).toHaveBeenCalled();
    const g = fixture();
    await g.api.showSaveLocalToExistingProfile(); g.panels[0][2][0].run();
    g.context.accountUid = () => "u2";
    await g.panels[1][2][0].run();
    expect(g.activate).not.toHaveBeenCalled();
  });
  it("does not use stale owner names in the mismatch warning", () => {
    const prompt = source.slice(source.indexOf("function showWorkspaceMismatchPrompt"), source.indexOf("function showLocalSaveFreshnessPrompt"));
    expect(prompt).not.toContain("binding?.profileName");
    expect(prompt).toContain("MismatchSafeBody");
    expect(prompt).toContain("showSaveLocalToExistingProfile");
    expect(prompt).toContain("showSaveLocalAsNewProfile");
  });
});
