import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
const claim = vi.hoisted(() => vi.fn());
vi.mock("../src/providers/stripe/website-commerce.js", () => ({claimWebsiteOrder: claim}));
import { AdminOperationsService } from "../src/admin/operations-service.js";

function setup() {
  const user = {uid:"u",disabled:false,emailVerified:false,providerData:[{providerId:"google.com",uid:"google-subject",email:"buyer@gmail.com"}]};
  const getUser=vi.fn().mockResolvedValue(user);
  const updateUser=vi.fn(async()=>({...user,email:"buyer@gmail.com",emailVerified:true}));
  const create=vi.fn();
  const db={collection:()=>({doc:()=>({id:"audit",create})})} as unknown as Firestore;
  const service=new AdminOperationsService(db,{getUser,updateUser} as unknown as Auth);
  const detail=vi.spyOn(service,"customerDetail").mockResolvedValue({entitlements:{accessKind:"premium_lifetime"}});
  return {service,getUser,updateUser,create,detail};
}
const input={actor:{uid:"admin",email:"admin@example.com"},uid:"u",sessionId:"cs_live_original",reason:"Customer purchase recovery after missing Google email",now:new Date("2026-10-06T08:00:00Z")};
beforeEach(()=>{vi.clearAllMocks();claim.mockResolvedValue({claimed:true});});
describe("audited website purchase recovery",()=>{
  it("restores the authoritative identity and runs the original exact-email Stripe claim",async()=>{
    const s=setup();
    await expect(s.service.reconcileWebsitePurchase(input)).resolves.toMatchObject({entitlements:{accessKind:"premium_lifetime"}});
    expect(claim).toHaveBeenCalledWith(expect.anything(),{uid:"u",email:"buyer@gmail.com",email_verified:true},"cs_live_original");
    expect(s.create).toHaveBeenCalledWith(expect.objectContaining({action:"purchase.reconcile.completed",targetId:"u"}));
  });
  it("does not grant access to a disabled or unverified third-party-email account",async()=>{
    for(const user of [{uid:"u",disabled:true},{uid:"u",disabled:false,email:"unknown@example.com",emailVerified:false,providerData:[]}]){
      const s=setup();s.getUser.mockResolvedValue(user);
      await expect(s.service.reconcileWebsitePurchase(input)).rejects.toThrow();
      expect(claim).not.toHaveBeenCalled();
    }
  });
  it("preserves Stripe ownership/refund failures without a success audit or replacement manual grant",async()=>{
    const s=setup();claim.mockRejectedValue(new Error("This purchase is already attached to another account."));
    await expect(s.service.reconcileWebsitePurchase(input)).rejects.toThrow("already attached");
    expect(s.detail).not.toHaveBeenCalled();
    expect(s.create.mock.calls.some(([d])=>d.action==="purchase.reconcile.completed")).toBe(false);
  });
});
