import {beforeEach,expect,it,vi} from "vitest";
const auth=vi.hoisted(()=>({
 signInWithEmailAndPassword:vi.fn(),createUserWithEmailAndPassword:vi.fn(),updatePassword:vi.fn(),
 validatePassword:vi.fn(),sendEmailVerification:vi.fn(),sendPasswordResetEmail:vi.fn(),reload:vi.fn()
}));
vi.mock("firebase/auth",()=>auth);
import {performPassword} from "../integrations/web/account-widget/passwords.js";
import {passwordText} from "../integrations/web/account-widget/password-text.js";
import {languages,translateSummary} from "../integrations/web/account-widget/account-languages.js";
function setup(values={email:" buyer@example.com ",password:"New-long-password12",confirm:"New-long-password12"}) {
 vi.stubGlobal("FormData",class {get(k){return values[k]??null;}});
 const button={disabled:false};
 const form={querySelectorAll:()=>[button],reset:vi.fn()};
 const user={uid:"original-uid",emailVerified:true};
 const host={auth:{currentUser:user},lang:"fr",desktopHandoff:{userCode:"test"},status:vi.fn(),renderUser:vi.fn(),
 querySelector:vi.fn(()=>({hidden:false,value:""})),request:vi.fn()};
 return {host,user,form,button};
}
beforeEach(()=>{
 vi.clearAllMocks();
 auth.validatePassword.mockResolvedValue({isValid:true});
 auth.signInWithEmailAndPassword.mockResolvedValue({user:{uid:"original-uid",emailVerified:true}});
 vi.stubGlobal("location",{origin:"https://wonderlang.app"});
 vi.stubGlobal("sessionStorage",{removeItem:vi.fn()});
});
it("completes the game handoff after password sign-in",async()=>{
 const f=setup();await performPassword(f.host,f.form,"signin");
 expect(auth.signInWithEmailAndPassword).toHaveBeenCalledWith(f.host.auth,"buyer@example.com","New-long-password12");
 expect(f.host.handoffReady).toBe(true);expect(f.host.renderUser).toHaveBeenCalledWith(f.user);
 expect(f.form.reset).toHaveBeenCalledOnce();expect(f.button.disabled).toBe(false);
});
it("keeps failed sign-in out of the handoff and allows retry",async()=>{
 const f=setup();auth.signInWithEmailAndPassword.mockRejectedValueOnce({code:"auth/invalid-credential"});
 await performPassword(f.host,f.form,"signin");expect(f.host.handoffReady).not.toBe(true);
 expect(f.host.status).toHaveBeenLastCalledWith("Incorrect email or password.");expect(f.button.disabled).toBe(false);
});
it("sets a password on the existing verified account",async()=>{
 const f=setup();await performPassword(f.host,f.form,"set");
 expect(auth.updatePassword).toHaveBeenCalledWith(f.user,"New-long-password12");
 expect(auth.createUserWithEmailAndPassword).not.toHaveBeenCalled();
});
it("blocks unverified password setup and mismatched passwords",async()=>{
 const f=setup();f.user.emailVerified=false;await performPassword(f.host,f.form,"set");
 expect(auth.updatePassword).not.toHaveBeenCalled();
 const g=setup({password:"New-long-password12",confirm:"different"});await performPassword(g.host,g.form,"create");
 expect(auth.createUserWithEmailAndPassword).not.toHaveBeenCalled();
});
it("continues the game handoff after admin recovery with the server-returned account",async()=>{
 const f=setup();f.host.passwordRecovery={uid:"original-uid",token:"secret"};f.host.request.mockResolvedValue({email:"buyer@example.com"});
 await performPassword(f.host,f.form,"recover");
 expect(f.host.request).toHaveBeenCalledWith("/.netlify/functions/password-recovery",expect.objectContaining({authenticated:false}));
 expect(f.host.handoffReady).toBe(true);expect(sessionStorage.removeItem).toHaveBeenCalledWith("wl-password-recovery");
});
it("retains the account and permits verification retry when email delivery fails after signup",async()=>{
 const f=setup();auth.createUserWithEmailAndPassword.mockResolvedValue({user:f.user});
 auth.sendEmailVerification.mockRejectedValueOnce({code:"auth/network-request-failed"});
 await performPassword(f.host,f.form,"create");
 expect(f.host.renderUser).toHaveBeenCalledWith(f.user);expect(f.host.handoffReady).not.toBe(true);
});
it("covers every customer password string in all supported languages",()=>{
 expect(Object.keys(passwordText).sort()).toEqual(languages.map(([l])=>l).sort());
 for(const [locale,values] of Object.entries(passwordText)){
   expect(values).toHaveLength(passwordText.en.length);
   values.forEach((value,index)=>{expect(value.trim()).not.toBe("");expect(translateSummary(passwordText.en[index],locale)).toBe(value);});
 }
});

it("requests password setup through the server for any sign-in provider",async()=>{
 const f=setup();await performPassword(f.host,f.form,"reset");
 expect(f.host.request).toHaveBeenCalledWith("/.netlify/functions/password-setup-request",{authenticated:false,method:"POST",body:{email:"buyer@example.com",locale:"fr"}});
 expect(auth.sendPasswordResetEmail).not.toHaveBeenCalled();
});
