import { describe, expect, it } from "vitest";
import { projectEntitlements } from "../src/domain/entitlement-projector.js";
import { CloudSaveProfileService } from "../src/cloud-save/profile-service.js";
import type { LedgerGrant } from "../src/domain/model.js";

const now = new Date("2026-09-16T12:00:00Z");
const grant = (product: LedgerGrant["product"], state: LedgerGrant["state"] = "active"): LedgerGrant => ({
  id: product, uid: "owner", provider: "google_play", providerTransactionId: product,
  product, state, startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-10-01T00:00:00Z",
  graceEndsAt: "2026-10-08T00:00:00Z", metadata: {mobilePlatform: "android"}
});

describe("Premium-only cloud policy", () => {
  it.each(["active", "grace"] as const)("keeps Monthly game access in %s without cloud", state => {
    expect(projectEntitlements("owner", [grant("mobile_full_monthly", state)], now))
      .toMatchObject({fullGame:true, cloudSave:false, premiumLifetime:false});
  });
  it("does not combine Monthly and permanent mobile into Premium", () => {
    expect(projectEntitlements("owner", [grant("mobile_full_monthly"), grant("mobile_polyglot_permanent")], now))
      .toMatchObject({fullGame:true, cloudSave:false, premiumLifetime:false});
  });
  it("keeps Premium cloud access and removes it if Premium is revoked despite active Monthly", () => {
    expect(projectEntitlements("owner", [grant("premium_lifetime_pass")], now))
      .toMatchObject({cloudSave:true, premiumLifetime:true});
    expect(projectEntitlements("owner", [grant("premium_lifetime_pass", "revoked"), grant("mobile_full_monthly")], now))
      .toMatchObject({fullGame:true, cloudSave:false, premiumLifetime:false});
  });
  it("rejects stale Monthly cloud flags before accessing any profile or storage", async () => {
    const entitlements = { effectiveEntitlements: async () => ({cloudSave:true,premiumLifetime:false}) };
    const service = new CloudSaveProfileService({} as never, {} as never, entitlements as never);
    const calls = [
      () => service.list("owner", now),
      () => service.create("owner", "New profile", now),
      () => service.rename("owner", "default", "Renamed", now),
      () => service.prepareUpload("owner", "default", {} as never, now),
      () => service.finalizeUpload("owner", "default", "upload", now),
      () => service.restoreRevision("owner", "default", "revision", "current", now),
      () => service.summary("owner", "default", now),
      () => service.downloadUrl("owner", "default", now)
    ];
    for (const call of calls) await expect(call()).rejects.toThrow("Cloud save requires a Premium Lifetime Pass.");
  });
});
