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

describe("Cloud-save purchase policy", () => {
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
    const entitlements = { effectiveEntitlements: async () => ({cloudSave:false,premiumLifetime:false}) };
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
    for (const call of calls) await expect(call()).rejects.toThrow("Cloud saves require an eligible purchase or active subscription.");
  });
});


describe("Apple purchase cloud access", () => {
  const apple = (product: LedgerGrant["product"], changes: Partial<LedgerGrant> = {}): LedgerGrant => ({
    ...grant(product), provider:"apple", metadata:{mobilePlatform:"ios"}, ...changes
  });
  it.each(["mobile_full_monthly", "mobile_polyglot_permanent"] as const)("includes cloud for %s without Premium or desktop ownership", product => {
    expect(projectEntitlements("owner", [apple(product)], now)).toMatchObject({
      fullGame:true, cloudSave:true, premiumLifetime:false, pcMacAccess:false, futureContent:false,
      mobilePlatforms:["ios"], cloudSaveEndsAt:"2026-10-01T00:00:00Z"
    });
  });
  it("retains cloud for permanent purchases without an expiry", () => {
    const permanent = apple("mobile_polyglot_permanent"); delete permanent.endsAt;
    const value = projectEntitlements("owner", [permanent], now);
    expect(value.cloudSave).toBe(true); expect(value.cloudSaveEndsAt).toBeUndefined();
  });
  it.each(["expired", "revoked", "refunded", "pending"] as const)("removes %s purchase cloud access", state => {
    for(const product of ["mobile_full_monthly", "mobile_polyglot_permanent"] as const)
      expect(projectEntitlements("owner", [apple(product,{state})],now).cloudSave).toBe(false);
  });
  it("expires monthly cloud even when another platform has permanent game access", () => {
    const mixed = [apple("mobile_full_monthly"), grant("mobile_polyglot_permanent")];
    expect(projectEntitlements("owner",mixed,now).cloudSaveEndsAt).toBe("2026-10-01T00:00:00Z");
    expect(projectEntitlements("owner",mixed,new Date("2026-10-01T00:00:00Z")).cloudSave).toBe(false);
  });
  it("sandbox cloud grants cannot unlock any paid game feature", () => {
    const value = projectEntitlements("owner",[apple("apple_sandbox_cloud")],now);
    expect(value).toMatchObject({cloudSave:true, fullGame:false, allLanguages:false, premiumLifetime:false,
      pcMacAccess:false, futureContent:false, accessKind:"none", mobilePlatforms:[], chapters:[], subscriptionState:"inactive"});
    expect(projectEntitlements("owner",[apple("apple_sandbox_cloud")],new Date("2026-10-01T00:00:00Z")).cloudSave).toBe(false);
  });
});
