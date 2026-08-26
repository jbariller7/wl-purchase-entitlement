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
});
