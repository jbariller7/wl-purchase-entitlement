import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {describe,it,expect,vi} from 'vitest';
const source=readFileSync(new URL('../integrations/rmmz/WonderLangAccountCloudSync.js',import.meta.url),'utf8');
describe('in-game subscription management',()=>{
 it('routes each provider to its own cancellation service',async()=>{
  for(const provider of ['google_play','apple','stripe']){
   const openExternalUrl=vi.fn(),request=vi.fn().mockResolvedValue({url:'https://billing.stripe.com/owned'}),showError=vi.fn();
   const ctx=vm.createContext({bridge:()=>({openExternalUrl}),request,showError,openAccountPanel:()=>{},authoritativeAccount:()=>null});
   vm.runInContext(source.slice(source.indexOf('  async function openBillingPortal('),source.indexOf('  async function ensureProfileSelection('))+'\nglobalThis.run=openBillingPortal;',ctx);
   await ctx.run({provider,id:'sub_owned'});
   expect(showError).not.toHaveBeenCalled();expect(openExternalUrl).toHaveBeenCalledTimes(1);
   if(provider==='stripe')expect(request).toHaveBeenCalledWith('/api/v1/billing-portal',{method:'POST',body:{subscriptionId:'sub_owned'}});
   if(provider==='google_play')expect(openExternalUrl.mock.calls[0]![0]).toContain('sku=wonderlangmonthly&package=com.wonderlang.app');
   if(provider==='apple')expect(openExternalUrl.mock.calls[0]![0]).toBe('https://apps.apple.com/account/subscriptions');
  }
 });
 it('keeps subscriptions until expiry but never extends offline access past the paid period',()=>{
  const now=Date.now();let ent:any={fullGame:true,cloudSave:false,premiumLifetime:false,accessKind:'subscription',subscriptionState:'active',computedAt:new Date(now-1000).toISOString(),subscriptionEndsAt:new Date(now+1000).toISOString()};
  const ctx=vm.createContext({Date,Math,Number,entitlement:()=>ent,restrictToGrantedPlatform:(v:any)=>v,OFFLINE_SUBSCRIPTION_GRACE_MS:7*86400000});
  vm.runInContext(source.slice(source.indexOf('  function effectiveCachedEntitlement('),source.indexOf('  function account()'))+'\nglobalThis.read=effectiveCachedEntitlement;',ctx);
  expect(ctx.read(now).fullGame).toBe(true);expect(ctx.read(now+2000).fullGame).toBe(false);
  ent={...ent,accessKind:'premium_lifetime',premiumLifetime:true,cloudSave:true};expect(ctx.read(now+2000).fullGame).toBe(true);
 });
});
