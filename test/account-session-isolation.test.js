import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {it,expect,vi} from 'vitest';
it('rejects a non-admin without signing out the customer session',async()=>{
 const source=readFileSync(new URL('../integrations/web/admin-console/admin.js',import.meta.url),'utf8');
 const auth={},app={}; let listener;
 const ctx={demo:false,state:{},fetch:vi.fn().mockResolvedValue({ok:true,json:async()=>({firebase:{projectId:'test'}})}),initializeApp:vi.fn(()=>app),getAuth:vi.fn(()=>auth),getRedirectResult:vi.fn().mockResolvedValue(null),onAuthStateChanged:vi.fn((a,cb)=>{listener=cb;}),api:vi.fn().mockRejectedValue(new Error('Not an administrator')),signOut:vi.fn(),signInScreen:vi.fn(),loadView:vi.fn()};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function start()'),source.lastIndexOf('start();'))+'globalThis.run=start;',ctx);
 await ctx.run(); await listener({uid:'customer'});
 expect(ctx.initializeApp).toHaveBeenCalledWith({projectId:'test'},'wonderlang-operations');
 expect(ctx.signOut).not.toHaveBeenCalled();expect(ctx.loadView).not.toHaveBeenCalled();
 expect(ctx.signInScreen).toHaveBeenLastCalledWith('Not an administrator');
});
