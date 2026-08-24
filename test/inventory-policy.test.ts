import { describe, expect, it } from "vitest";
import { assertKnownInventoryTabs, inventoryThresholdFor, parseInventoryStockPolicy } from "../src/config/inventory-policy.js";

describe("key inventory alert policy", () => {
  it("uses ten as the fail-safe default threshold", () => {
    const policy = parseInventoryStockPolicy();
    expect(inventoryThresholdFor("Steam English", policy)).toBe(10);
  });

  it("supports a validated default and exact per-tab overrides", () => {
    const policy = parseInventoryStockPolicy({
      defaultThreshold: "15",
      thresholdsJson: JSON.stringify({ "Steam Japanese": 25, "Itch English": 5 })
    });
    expect(inventoryThresholdFor("Steam English", policy)).toBe(15);
    expect(inventoryThresholdFor("Steam Japanese", policy)).toBe(25);
    expect(inventoryThresholdFor("Itch English", policy)).toBe(5);
  });

  it("allows zero to disable low-stock headroom for a deliberate tab", () => {
    const policy = parseInventoryStockPolicy({ defaultThreshold: 0, thresholdsJson: "{}" });
    expect(inventoryThresholdFor("Direct download", policy)).toBe(0);
  });

  it("rejects an override whose exact sheet-tab name is unknown", () => {
    const policy = parseInventoryStockPolicy({ thresholdsJson: '{"Steam Japnese":20}' });
    expect(() => assertKnownInventoryTabs(policy, ["Steam Japanese", "Steam English"]))
      .toThrow("unknown sheet tabs: Steam Japnese");
  });

  it.each(["not-json", "[]", '{"Steam English":-1}', '{"Steam English":1.5}', '{"":10}'])(
    "rejects malformed or unsafe overrides: %s",
    (thresholdsJson) => {
      expect(() => parseInventoryStockPolicy({ thresholdsJson })).toThrow("KEY_INVENTORY_LOW_STOCK_THRESHOLDS");
    }
  );
});
