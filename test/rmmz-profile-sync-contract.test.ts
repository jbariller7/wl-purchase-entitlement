import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const pluginUrl = new URL("../integrations/rmmz/WonderLangAccountCloudSync.js", import.meta.url);

describe("RPG Maker whole-profile sync contract", () => {
  it("syncs global and all save files while removing individual-slot controls", async () => {
    const source = await readFile(pluginUrl, "utf8");
    expect(source).toContain('"global", ...Array.from');
    expect(source).toContain('magic: "WL_CLOUD_PROFILE"');
    expect(source).toContain("scheduleProfileSync");
    expect(source).toContain("Manage profiles");
    expect(source).not.toContain("data-use-cloud");
    expect(source).not.toContain("data-upload-local");
    expect(source).not.toContain('registerCommand(pluginName, "uploadSave"');
  });

  it("keeps device configuration outside player profiles", async () => {
    const source = await readFile(pluginUrl, "utf8");
    const managedNames = source.slice(source.indexOf("function managedSaveNames"), source.indexOf("function hasLocalPlayerSaves"));
    expect(managedNames).toContain('"global"');
    expect(managedNames).toContain("file${index}");
    expect(managedNames).not.toContain("config");
  });

  it("does not re-upload a profile while applying a cloud restore", async () => {
    const source = await readFile(pluginUrl, "utf8");
    const guardedWrites = source.match(/if \(!applyingProfile && \/\^\(\?:global\|file/g) ?? [];
    expect(guardedWrites).toHaveLength(2);
  });

  it("passes the native Android App Check token with cloud-save requests", async () => {
    const source = await readFile(pluginUrl, "utf8");
    expect(source).toContain("getCachedAppCheckToken()");
    expect(source).toContain('bridge()?.getCachedAppCheckToken?.()');
    expect(source).toContain('"x-firebase-appcheck": appCheckToken');
  });

  it("stops overlay input before RPG Maker document handlers can receive it", async () => {
    const source = await readFile(pluginUrl, "utf8");
    expect(source).toContain("function blockGameInput(overlay)");
    for (const eventName of ["mousedown", "mouseup", "click", "touchstart", "touchend", "pointerdown", "keydown", "keyup"]) {
      expect(source).toContain(`"${eventName}"`);
    }
    expect(source).toContain("event.stopPropagation()");
    expect(source).toContain("globalThis.TouchInput.clear()");
    expect(source).toContain("globalThis.Input.clear()");
    expect(source.indexOf("blockGameInput(overlay)")).toBeLessThan(source.indexOf("document.body.appendChild(overlay)"));
  });

  it("uses the active title theme and gives the account dialog exclusive focus", async () => {
    const source = await readFile(pluginUrl, "utf8");
    expect(source).toContain("ColorThemeUtils?.computeThemeFromConfig?.()");
    expect(source).toContain('document.documentElement.classList.add("wl-account-ui-open")');
    expect(source).toContain('document.documentElement.classList.remove("wl-account-ui-open")');
    expect(source).toContain("html.wl-account-ui-open #titleListUI .panel");
    expect(source).toContain("z-index:1000001");
    expect(source).toContain('event.target?.closest?.(".wl-account-scroll")');
  });

  it("offers fast profile switching but synchronizes the current profile before downloading another", async () => {
    const source = await readFile(pluginUrl, "utf8");
    expect(source).toContain("data-profile-switcher");
    expect(source).toContain("Active save profile");
    expect(source).toContain("Sync and switch");
    expect(source).toContain("Nothing was switched or downloaded");
    const switchFlow = source.slice(source.indexOf("async function switchFromActiveProfile"), source.indexOf("async function selectProfile"));
    expect(switchFlow.indexOf("await syncActiveProfileNow()")).toBeGreaterThan(-1);
    expect(switchFlow.indexOf("return activateProfile(profile")).toBeGreaterThan(switchFlow.indexOf("await syncActiveProfileNow()"));
  });

  it("shows retained profile backups and applies a restored active version only after the server accepts it", async () => {
    const source = await readFile(pluginUrl, "utf8");
    expect(source).toContain("data-profile-backups");
    expect(source).toContain("data-restore-backup");
    expect(source).toContain("Restore this version");
    expect(source).toContain("expectedCurrentRevision: profile.currentRevision");
    const restoreFlow = source.slice(source.indexOf("async function restoreProfileBackup"), source.indexOf("async function clearWorkspaceForProfile"));
    expect(restoreFlow).toContain("/revisions/${encodeURIComponent(backup.revision)}/restore");
    expect(restoreFlow.indexOf("await request(")).toBeGreaterThan(-1);
    expect(restoreFlow.indexOf("await restoreProfile(profile.profileId)")).toBeGreaterThan(restoreFlow.indexOf("await request("));
  });
});
