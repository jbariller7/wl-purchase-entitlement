import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {expect,it,vi} from 'vitest';
const source=readFileSync(new URL('../integrations/rmmz/FacebookStartTrial.js',import.meta.url),'utf8');
function game({mobile=false,pixel=true,offline=false,demo=false,saves=false,storage=new Map()}={}){
 const tracks=[],scripts=[],listeners={};
 const ctx={console,Set,Map,Uint8Array,TextEncoder,AbortController,require:createRequire(import.meta.url),
  // No crypto.subtle: this reproduces an NW.js insecure-context runtime.
  crypto:{},navigator:{userAgent:mobile?'Android':'NW.js',platform:'Win32'},
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  PluginManager:{parameters:()=>({pixelId:'552284573796131'})},
  Utils:{isMobileDevice:()=>mobile},DataManager:{_globalInfo:saves?[null,{playtime:'1:00:00'}]:[]},
  ConfigManager:{uiLanguage:'EN'},Scene_Boot:class{start(){}},Scene_Base:class{update(){}},
  Scene_Title:class{},SceneManager:{},XMLHttpRequest:class{open(){}send(){this.status=demo?404:200}},
  setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1,
  addEventListener:(k,fn)=>listeners[k]=fn,
  document:{cookie:'',createElement:()=>({remove(){}}),head:{appendChild:s=>scripts.push(s)}}};
 ctx.window=ctx;
 ctx.fbq=(...args)=>tracks.push(args);if(pixel)ctx.fbq.callMethod=()=>{};
 ctx.fetch=vi.fn(async(url,options)=>{if(offline)throw Error('offline');const body=JSON.parse(options.body);return{ok:true,json:async()=>({eventId:body.emailSha256?'steam-bonus-v1:'+body.emailSha256:'desktop-launch-v1:'+body.launchId,trackBrowser:true})}});
 vm.runInNewContext(source.replace(/\}\)\(\);\s*$/,'window.testHooks={queueSteamBonusConversion,flushDesktopReports};})();'),ctx);
 const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
 return {ctx,tracks,scripts,listeners,storage,settle};
}
it('hashes and persists PDF claims without Web Crypto and deduplicates retries',async()=>{
 const g=game();await g.ctx.testHooks.queueSteamBonusConversion(' Player@Example.com ');
 const hash=createHash('sha256').update('player@example.com').digest('hex');
 expect(JSON.parse(g.ctx.fetch.mock.calls[0][1].body)).toEqual({emailSha256:hash});
 const purchases=g.tracks.filter(x=>x[1]==='Purchase');expect(purchases).toHaveLength(1);
 expect(purchases[0][3]).toEqual({eventID:'steam-bonus-v1:'+hash});
 await g.ctx.testHooks.queueSteamBonusConversion('player@example.com');
 expect(g.ctx.fetch).toHaveBeenCalledTimes(1);
 expect(g.storage.get('wl_steam_bonus_conversion_v1')).not.toContain('@');
});
it('delivers browser fallback when the API fails and retries the server immediately on reconnect',async()=>{
 const g=game({offline:true});await g.ctx.testHooks.queueSteamBonusConversion('player@example.com');
 expect(g.tracks.filter(x=>x[1]==='Purchase')).toHaveLength(1);
 expect(JSON.parse(g.storage.get('wl_steam_bonus_conversion_v1')).sent).toBe(false);
 g.ctx.fetch.mockImplementationOnce(async(url,o)=>({ok:true,json:async()=>({eventId:'steam-bonus-v1:'+JSON.parse(o.body).emailSha256,trackBrowser:true})}));
 g.listeners.online();await g.settle();
 expect(JSON.parse(g.storage.get('wl_steam_bonus_conversion_v1')).sent).toBe(true);
 expect(g.tracks.filter(x=>x[1]==='Purchase')).toHaveLength(1);
});
it('keeps a blocked Pixel eligible after server queue acceptance',async()=>{
 const g=game({pixel:false});await g.ctx.testHooks.queueSteamBonusConversion('player@example.com');
 const pending=JSON.parse(g.storage.get('wl_steam_bonus_conversion_v1'));
 expect(pending.serverQueued).toBe(true);expect(pending.sent).toBeFalsy();
 expect(g.tracks.filter(x=>x[1]==='Purchase')).toHaveLength(0);
 g.ctx.fbq.callMethod=()=>{};g.listeners.focus();await g.settle();
 expect(g.tracks.filter(x=>x[1]==='Purchase')).toHaveLength(1);
 expect(g.ctx.fetch).toHaveBeenCalledTimes(1);
});
it('sends a zero-value first full launch once and persists its ID across restarts',async()=>{
 const g=game();new g.ctx.Scene_Boot().start();await g.settle();
 const first=g.tracks.find(x=>x[1]==='Purchase');
 expect(first[2]).toMatchObject({value:0,conversion_kind:'desktop_first_launch_proxy'});
 expect(first[3].eventID).toMatch(/^desktop-launch-v1:/);
 const second=game({storage:g.storage});new second.ctx.Scene_Boot().start();await second.settle();
 expect(second.ctx.fetch).not.toHaveBeenCalled();expect(second.tracks.filter(x=>x[1]==='Purchase')).toHaveLength(0);
});
it.each([{mobile:true},{saves:true}])('does not invent a desktop first purchase on mobile or existing saves: %j',async options=>{
 const g=game(options);new g.ctx.Scene_Boot().start();await g.settle();
 expect(g.ctx.fetch).not.toHaveBeenCalled();expect(g.tracks.filter(x=>x[1]==='Purchase')).toHaveLength(0);
});
