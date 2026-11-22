import {describe,it,expect,vi,beforeEach} from "vitest";
import {PasswordRecoveryService} from "../src/identity/password-recovery.js";
const invalidation=vi.hoisted(()=>vi.fn());
vi.mock("../src/device-sign-in/service.js",()=>({invalidateDeviceSignInsForUid:invalidation}));
function fixture() {
  const data=new Map<string,any>();
  let counter=0, transaction=Promise.resolve();
  const ref=(path:string):any=>({id:path.split("/").at(-1),path,
    get:async()=>({exists:data.has(path),data:()=>structuredClone(data.get(path))}),
    update:async(value:any)=>data.set(path,{...data.get(path),...value})});
  const db:any={collection:(name:string)=>({doc:(id=String(++counter))=>ref(name+"/"+id)}),
    runTransaction:(fn:any)=>{
      const job=transaction.then(()=>fn({get:(r:any)=>r.get(),set:(r:any,v:any)=>data.set(r.path,v),
        create:(r:any,v:any)=>data.set(r.path,v),update:(r:any,v:any)=>r.update(v)}));
      transaction=job.catch(()=>{});return job;
    }};
  const user:any={uid:"customer",email:"buyer@example.com",disabled:false};
  const auth:any={getUserByEmail:vi.fn(async()=>user),getUser:vi.fn(async()=>user),
    updateUser:vi.fn(async()=>user),revokeRefreshTokens:vi.fn()};
  const service=new PasswordRecoveryService(db,auth);
  const now=new Date("2026-11-19T12:00:00Z");
  const issue=()=>service.issue({email:user.email,actor:{uid:"owner",email:"owner@example.com"},reason:"Verified purchase ownership",now});
  const input=(link:string)=>({uid:"customer",token:link.split(".").at(-1)!,password:"A-long-test-password-42",now});
  return {data,auth,user,service,issue,input,now};
}
beforeEach(()=>invalidation.mockReset());
describe("customer recovery",()=>{
  it.each(["google.com","apple.com"])("recovers a provider-only %s email on the same UID without changing it before redemption",async(providerId)=>{
    const f=fixture(); delete f.user.email;
    f.user.providerData=[{providerId,uid:"provider-id",email:"engelbre2002@gmail.com"}];
    f.auth.getUserByEmail.mockRejectedValue({code:"auth/user-not-found"});
    f.auth.listUsers=vi.fn(async()=>({users:[f.user]}));
    const result=await f.service.issue({email:"engelbre2002@gmail.com",actor:{uid:"owner",email:"owner@example.com"},reason:"Verified ownership",now:f.now});
    expect(f.auth.updateUser).not.toHaveBeenCalled();
    expect(await f.service.consume(f.input(result.link))).toMatchObject({email:"engelbre2002@gmail.com"});
    expect(f.auth.updateUser).toHaveBeenCalledWith("customer",{password:f.input(result.link).password,emailVerified:true,email:"engelbre2002@gmail.com"});
  });
  it("rejects a removed provider email without attaching it to the account",async()=>{
    const f=fixture();const result=await f.issue();delete f.user.email;f.user.providerData=[];
    await expect(f.service.consume(f.input(result.link))).rejects.toThrow("unavailable");
    expect(f.auth.updateUser).not.toHaveBeenCalled();
  });

  it("sets a verified password on the original account, invalidates sessions and rejects reuse",async()=>{
    const f=fixture(),result=await f.issue(),i=f.input(result.link);
    expect(JSON.stringify([...f.data.values()])).not.toContain(i.token);
    expect(await f.service.consume(i)).toMatchObject({email:f.user.email});
    expect(f.auth.updateUser).toHaveBeenCalledWith("customer",{password:i.password,emailVerified:true});
    expect(f.auth.revokeRefreshTokens).toHaveBeenCalledWith("customer");
    expect(invalidation).toHaveBeenCalledWith(expect.anything(),"customer",f.now);
    await expect(f.service.consume(i)).rejects.toThrow("unavailable");
  });
  it("rejects expired and replaced links without changing the account",async()=>{
    const f=fixture(),old=await f.issue(),latest=await f.issue();
    await expect(f.service.consume(f.input(old.link))).rejects.toThrow("unavailable");
    await expect(f.service.consume({...f.input(latest.link),now:new Date(+f.now+31*60_000)})).rejects.toThrow("unavailable");
    expect(f.auth.updateUser).not.toHaveBeenCalled();
  });
  it("allows only one concurrent redemption",async()=>{
    const f=fixture(),r=await f.issue();
    const results=await Promise.allSettled([f.service.consume(f.input(r.link)),f.service.consume(f.input(r.link))]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect(f.auth.updateUser).toHaveBeenCalledTimes(1);
  });
  it("fails closed if email, account privileges or enabled state change",async()=>{
    for(const change of [{email:"other@example.com"},{disabled:true}]){
      const f=fixture(),r=await f.issue();Object.assign(f.user,change);
      await expect(f.service.consume(f.input(r.link))).rejects.toThrow("unavailable");
      expect(f.auth.updateUser).not.toHaveBeenCalled();
    }
  });
  it("allows password setup for administrator and reviewer accounts without changing privileges",async()=>{
    for(const changes of [{customClaims:{admin:true}},{uid:"store-reviewer-test"}]){
      const f=fixture();Object.assign(f.user,changes);const r=await f.issue();
      await f.service.consume({...f.input(r.link),uid:f.user.uid});
      expect(f.auth.updateUser).toHaveBeenCalledWith(f.user.uid,{password:f.input(r.link).password,emailVerified:true});
    }
  });
  it("keeps an interrupted redemption unusable and allows an admin to replace it after failure",async()=>{
    const f=fixture(),r=await f.issue();f.auth.updateUser.mockRejectedValueOnce(Error("network"));
    await expect(f.service.consume(f.input(r.link))).rejects.toThrow("unavailable");
    await expect(f.service.consume(f.input(r.link))).rejects.toThrow("unavailable");
    const next=await f.issue();await f.service.consume(f.input(next.link));
    expect(f.auth.updateUser).toHaveBeenCalledTimes(2);
  });
});
