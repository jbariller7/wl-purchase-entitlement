import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { it, expect, vi } from 'vitest';
const source = readFileSync('integrations/web/account-widget/wonderlang-account.js','utf8');
function storage(){const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};}
function harness(url){
 const context=vm.createContext({HTMLElement:class{},location:new URL(url),URL,URLSearchParams,history:{replaceState:vi.fn()},document:{title:''},sessionStorage:storage(),localStorage:storage(),DESKTOP_HANDOFF_KEY:'handoff',DESKTOP_REDIRECT_KEY:'redirect',sendSignInLinkToEmail:vi.fn().mockResolvedValue(),isSignInWithEmailLink:()=>true,signInWithEmailLink:vi.fn().mockResolvedValue(),demoMode:false,setTimeout:vi.fn(),window:{close:vi.fn()}});
 vm.runInContext(source.slice(source.indexOf('function desktopHandoffFromLocation()'),source.indexOf('function escapeHtml'))+source.slice(source.indexOf('class WonderLangAccount extends'),source.indexOf('customElements.define("wonderlang-account"'))+'\nglobalThis.Widget=WonderLangAccount;globalThis.restore=desktopHandoffFromLocation;',context);
 const page=new context.Widget();page.auth={currentUser:{uid:'confirmed-user'}};page.querySelector=()=>({});page.status=vi.fn();page.fail=e=>{throw e};return{context,page};
}
it('carries desktop approval through an email link opened in a new browser session',async()=>{
 const initial=harness('https://wl-purchase-entitlement.netlify.app/account/');
 initial.page.desktopHandoff={userCode:'ABCD-2345',approvalSecret:'B'.repeat(43)};
 await initial.page.sendEmailLink('tester@example.com',false);
 const options=initial.context.sendSignInLinkToEmail.mock.calls[0][2];
 const url=new URL(options.url);
 expect(url.search).not.toContain('desktop_sign_in');expect(url.hash).toContain('desktop_sign_in=');
 const receiving=harness(options.url);receiving.page.desktopHandoff=receiving.context.restore();
 expect(receiving.page.desktopHandoff).toEqual(initial.page.desktopHandoff);
 receiving.page.confirmEmailForLink=async()=> 'tester@example.com';
 receiving.page.renderSignInMethods=vi.fn();receiving.page.request=vi.fn().mockResolvedValue({approved:true});
 await receiving.page.finishEmailLink();
 expect(receiving.page.request).toHaveBeenCalledWith('/api/v1/device-sign-in/approve',{method:'POST',body:initial.page.desktopHandoff});
 expect(receiving.page.innerHTML).toContain('Signed in successfully.');
 expect(receiving.context.sessionStorage.getItem('handoff')).toBeNull();
});
it('does not attach a game handoff to account-linking email',async()=>{
 const {page,context}=harness('https://wl-purchase-entitlement.netlify.app/account/');
 page.desktopHandoff={userCode:'ABCD-2345',approvalSecret:'B'.repeat(43)};
 await page.sendEmailLink('tester@example.com',true);
 expect(new URL(context.sendSignInLinkToEmail.mock.calls[0][2].url).hash).toBe('');
});

