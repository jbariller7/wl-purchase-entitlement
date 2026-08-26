import { describe, expect, it, vi } from "vitest";
import {
  LegacyKeyInventoryDiagnosticService,
  summarizeKeyInventoryRows
} from "../src/legacy/key-inventory-diagnostic.js";

describe("read-only legacy key-inventory diagnostic", () => {
  it("counts blank versus assigned rows without returning keys or personal data", async () => {
    const get = vi.fn().mockResolvedValue({
      data: {
        values: [
          ["STEAM-SECRET-ONE", ""],
          ["STEAM-SECRET-TWO", "private-player@example.com"],
          ["STEAM-SECRET-TWO", "another-private-player@example.com"],
          ["", "ignored@example.com"]
        ]
      }
    });
    const service = new LegacyKeyInventoryDiagnosticService({
      sheetsFactory: async () => ({ spreadsheets: { values: { get } } }),
      spreadsheetId: "private-sheet-id",
      tabs: ["English Steam"]
    });

    const result = await service.compare([
      { sheetTab: "English Steam", available: 0, assigned: 0 }
    ], new Date("2026-08-27T12:00:00.000Z"));
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      checkedAt: "2026-08-27T12:00:00.000Z",
      readOnly: true,
      state: "mismatch",
      passed: false,
      readyForInitialImport: false,
      sheet: { available: 1, assigned: 2, total: 3, duplicateRows: 1 },
      firestore: { available: 0, assigned: 0, total: 0 }
    });
    expect(get).toHaveBeenCalledWith({ spreadsheetId: "private-sheet-id", range: "'English Steam'!A2:B" });
    for (const privateValue of [
      "STEAM-SECRET-ONE",
      "STEAM-SECRET-TWO",
      "private-player@example.com",
      "another-private-player@example.com",
      "ignored@example.com",
      "private-sheet-id"
    ]) expect(serialized).not.toContain(privateValue);
  });

  it("distinguishes a safe initial import from an in-sync mirror", async () => {
    const rows = [["KEY-ONE", ""], ["KEY-TWO", "assigned@example.com"]];
    const service = new LegacyKeyInventoryDiagnosticService({
      sheetsFactory: async () => ({ spreadsheets: { values: { get: vi.fn().mockResolvedValue({ data: { values: rows } }) } } }),
      spreadsheetId: "sheet",
      tabs: ["Polyglot Steam"]
    });

    await expect(service.compare([
      { sheetTab: "Polyglot Steam", available: 0, assigned: 0 }
    ], new Date("2026-08-27T12:00:00.000Z"))).resolves.toMatchObject({
      state: "ready_for_initial_import",
      readyForInitialImport: true,
      passed: false
    });
    await expect(service.compare([
      { sheetTab: "Polyglot Steam", available: 1, assigned: 1 }
    ], new Date("2026-08-27T12:01:00.000Z"))).resolves.toMatchObject({
      state: "in_sync",
      readyForInitialImport: false,
      passed: true
    });
  });

  it("returns a fixed safe failure instead of provider or credential details", async () => {
    const service = new LegacyKeyInventoryDiagnosticService({
      sheetsFactory: async () => { throw new Error("credential secret-key-value rejected by Google"); },
      spreadsheetId: "secret-sheet-id",
      tabs: ["Polyglot Itch"]
    });

    const result = await service.compare([], new Date("2026-08-27T12:00:00.000Z"));
    expect(result).toMatchObject({
      state: "unavailable",
      passed: false,
      readOnly: true,
      readyForInitialImport: false,
      tabs: [],
      issues: ["Google Sheets inventory could not be read with the configured server credential."]
    });
    expect(JSON.stringify(result)).not.toMatch(/secret|credential secret-key-value|sheet-id/i);
  });

  it("summarizes rows deterministically without exposing their contents", () => {
    expect(summarizeKeyInventoryRows("Tab", [["A", ""], ["B", "assigned"], ["B", "assigned"]])).toEqual({
      sheetTab: "Tab",
      available: 1,
      assigned: 2,
      total: 3,
      duplicateRows: 1
    });
  });
});
