import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("isolated integration configuration", () => {
  it("points duplicate mobile adapters at the isolated entitlement service", () => {
    const rmmz = read("integrations/rmmz/WonderLangAccountCloudSync.js");
    const ios = read("integrations/ios/WonderLangEntitlementStore.swift");
    for (const source of [rmmz, ios]) {
      expect(source).toContain("https://wl-purchase-entitlement.netlify.app");
      expect(source).not.toContain("https://purchased-keys-automation.netlify.app");
    }
  });

  it("schedules the outbox worker while keeping processing disabled by default", () => {
    const netlify = read("netlify.toml");
    const example = read(".env.example");
    expect(netlify).toMatch(/\[functions\."outbox-worker"\][\s\S]*schedule\s*=\s*"\*\/5 \* \* \* \*"/);
    expect(example).toMatch(/^OUTBOX_PROCESSING_ENABLED=false$/m);
    expect(example).toMatch(/^LEGACY_FULFILLMENT_ENABLED=false$/m);
  });
});
