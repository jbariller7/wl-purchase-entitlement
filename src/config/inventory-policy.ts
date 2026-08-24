import { z } from "zod";

const MAX_THRESHOLD = 1_000_000;
const thresholdSchema = z.coerce.number().int().min(0).max(MAX_THRESHOLD);
const overridesSchema = z.record(z.string().min(1), z.number().int().min(0).max(MAX_THRESHOLD));

export interface InventoryStockPolicy {
  defaultThreshold: number;
  thresholdsBySheetTab: Readonly<Record<string, number>>;
}

export function parseInventoryStockPolicy(input: {
  defaultThreshold?: unknown;
  thresholdsJson?: string;
} = {}): InventoryStockPolicy {
  const defaultThreshold = thresholdSchema.parse(input.defaultThreshold ?? 10);
  let decoded: unknown = {};
  try {
    decoded = JSON.parse(input.thresholdsJson?.trim() || "{}");
  } catch {
    throw new Error("KEY_INVENTORY_LOW_STOCK_THRESHOLDS must be a JSON object of sheet-tab names to non-negative integer thresholds.");
  }
  const parsed = overridesSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error("KEY_INVENTORY_LOW_STOCK_THRESHOLDS must be a JSON object of sheet-tab names to non-negative integer thresholds.");
  }
  return { defaultThreshold, thresholdsBySheetTab: Object.freeze({ ...parsed.data }) };
}

export function inventoryThresholdFor(sheetTab: string, policy: InventoryStockPolicy): number {
  return policy.thresholdsBySheetTab[sheetTab] ?? policy.defaultThreshold;
}

export function assertKnownInventoryTabs(policy: InventoryStockPolicy, knownTabs: readonly string[]): void {
  const known = new Set(knownTabs);
  const unknown = Object.keys(policy.thresholdsBySheetTab).filter((sheetTab) => !known.has(sheetTab));
  if (unknown.length) {
    throw new Error(`KEY_INVENTORY_LOW_STOCK_THRESHOLDS contains unknown sheet tabs: ${unknown.sort().join(", ")}.`);
  }
}

export function inventoryStockPolicyFromEnvironment(environment: NodeJS.ProcessEnv = process.env): InventoryStockPolicy {
  return parseInventoryStockPolicy({
    ...(environment.KEY_INVENTORY_DEFAULT_LOW_STOCK_THRESHOLD !== undefined
      ? { defaultThreshold: environment.KEY_INVENTORY_DEFAULT_LOW_STOCK_THRESHOLD }
      : {}),
    ...(environment.KEY_INVENTORY_LOW_STOCK_THRESHOLDS !== undefined
      ? { thresholdsJson: environment.KEY_INVENTORY_LOW_STOCK_THRESHOLDS }
      : {})
  });
}
