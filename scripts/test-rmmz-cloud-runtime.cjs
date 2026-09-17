const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(process.argv[2] || 'integrations/rmmz/WonderLangAccountCloudSync.js', 'utf8');
function harness(initial = {}) {
  const disk = new Map(Object.entries(initial));
  const listeners = {}, timers = [];
  const local = new Map();
  let now=Date.now();
  class TestDate extends Date { constructor(...args) { super(...(args.length?args:[now])); } static now(){return now;} }
  const ctx = {
    console: { warn() {} }, TextEncoder, TextDecoder, TypeError, Date:TestDate, crypto: webcrypto,
    navigator: { onLine: true }, document: { hidden: false, addEventListener(n, f) { listeners[n] = f; } },
    localStorage: { getItem: k => local.get(k), setItem: (k,v) => local.set(k,v), removeItem: k => local.delete(k) },
    PluginManager: { parameters: () => ({Enabled:'true'}), registerCommand() {} },
    setTimeout: (fn, delay) => { timers.push({fn,delay}); return timers.length; }, clearTimeout() {}, setInterval() {},
    CustomEvent: class { constructor(type, options) { this.type=type; Object.assign(this,options); } },
    DataManager: { _globalInfo: [], maxSavefiles: () => 20,
      removeInvalidGlobalInfo() { const globalInfo=this._globalInfo; for(const info of globalInfo) { const id=globalInfo.indexOf(info); if(info && !ctx.StorageManager.exists('file'+id)) delete globalInfo[id]; } } },
    StorageManager: {
      exists: n => disk.has(n),
      loadObject: async n => structuredClone(disk.get(n) ?? null),
      saveObject: async (n,o) => { disk.set(n,structuredClone(o)); },
      remove: async n => { disk.delete(n); },
      objectToJson: async o => JSON.stringify(o), jsonToObject: async s => JSON.parse(s)
    },
    fetch: async () => ({ok:true,status:200,json:async()=>({uid:'test',entitlements:{cloudSave:true}})})
  };
  ctx.window=ctx;
  ctx.addEventListener=(n,f)=>{listeners[n]=f;}; ctx.dispatchEvent=()=>{};
  const injected = source.replace(/\}\)\(\);\s*$/, `globalThis.probe = {
    applyProfileBundle, buildProfileBundle, resumeCloudSync, showOfflineNotice, request,
    uploadProfile, presentProfileConflict, syncFromUi, saveWorkspaceBinding, workspaceBinding, markProfileDirty, retryQueue, profileFilesFingerprint, bindReleaseTap,
    network(r,f) { request=r; cloudFetch=f; },
    unpause() { startupProfileDecisionPending=false; },
    syncState() { return {startupProfileDecisionPending, conflictProfileId}; },
    panels(log) { showPanel=(title,body,actions=[])=>{log.push({title,body,actions});activeOverlay={dataset:{},remove(){},querySelector(){return null;}};return activeOverlay;}; closeOverlay=()=>{activeOverlay=null;}; },
    watchPanels(log) { showPanel = (title) => {log.push(title);activeOverlay={dataset:{}};return activeOverlay;}; },
    closePanel() { activeOverlay=null; },
    setFailure(id) { failedStartupWorkspace=id; },
    checkStartupProfileFreshness, setActiveProfileId,
    setCurrent(value) { current=value; },
    setReady() { foregroundReadyAt=0; },
    state() { return {networkUnavailable, offlineNoticePending, offlineNoticeShown, applyingProfile}; }
  };})();`);
  vm.runInNewContext(injected,ctx);
  return {ctx,probe:ctx.probe,disk,listeners,timers,advance(ms){now+=ms;}};
}
function bundle(global, files={}) { return {magic:'WL_CLOUD_PROFILE',version:1,profileId:'p',files:{global:JSON.stringify(global),...Object.fromEntries(Object.entries(files).map(([k,v])=>[k,JSON.stringify(v)]))}}; }
test('restores normal array metadata and every save as a single profile',async()=>{
 const h=harness({global:[],file2:{old:true}});
 await h.probe.applyProfileBundle(bundle([null,{title:'slot1'}],{file1:{system:{}}}),'p');
 assert.equal(h.ctx.DataManager._globalInfo[1].title,'slot1'); assert(!h.disk.has('file2')); assert(h.disk.has('file1'));
 assert([...h.disk.keys()].some(k=>k.startsWith('wl-profile-recovery-')));
});
test('restores wrapped metadata without globalInfo iterable error',async()=>{
 const h=harness({global:[]});
 await h.probe.applyProfileBundle(bundle({globalInfo:[null,{title:'wrapped'}]},{file1:{system:{}}}),'p');
 assert(Array.isArray(h.ctx.DataManager._globalInfo)); assert.equal(h.ctx.DataManager._globalInfo[1].title,'wrapped');
});
test('indexed metadata preserves sparse slot IDs instead of compacting them',async()=>{
 const h=harness({global:[]});
 await h.probe.applyProfileBundle(bundle({'4':{title:'four'}},{file4:{system:{}}}),'p');
 assert.equal(h.ctx.DataManager._globalInfo[4].title,'four'); assert.equal(h.ctx.DataManager._globalInfo[0],undefined);
});
test('empty profile with null metadata is safely loadable',async()=>{
 const h=harness({global:[]}); await h.probe.applyProfileBundle(bundle(null),'p');
 assert(Array.isArray(h.ctx.DataManager._globalInfo)); assert.equal(h.ctx.DataManager._globalInfo.length,0);
});
test('invalid index is rejected before any local save is changed',async()=>{
 const h=harness({global:[],file1:{system:{},progress:42}}); const before=JSON.stringify([...h.disk]);
 await assert.rejects(h.probe.applyProfileBundle(bundle({broken:true},{file1:{system:{}}}),'p'));
 assert.equal(JSON.stringify([...h.disk]),before);
});
test('storage write failure restores disk and original in-memory index',async()=>{
 const h=harness({global:[null,{title:'old'}],file1:{system:{},progress:42}});
 const original=[null,{title:'old'}]; h.ctx.DataManager._globalInfo=original;
 const save=h.ctx.StorageManager.saveObject; let failed=false;
 h.ctx.StorageManager.saveObject=async(n,o)=>{if(n==='file2'&&!failed){failed=true;throw Error('disk full');}return save(n,o);};
 await assert.rejects(h.probe.applyProfileBundle(bundle([null,null,{title:'new'}],{file2:{system:{}}}),'p'),/disk full/);
 assert.equal(h.disk.get('file1').progress,42); assert(!h.disk.has('file2')); assert.equal(h.ctx.DataManager._globalInfo,original); assert.equal(h.probe.state().applyingProfile,false);
});
test('a native/token TypeError is not classified as an offline connection',async()=>{
 const h=harness(); h.ctx.WLAccountManager={getCachedIdToken(){throw new TypeError('local code bug');}};
 await assert.rejects(h.probe.request('/api/v1/me')); assert.equal(h.probe.state().networkUnavailable,false);
});
test('a failed request on an online device queues recovery without an offline popup',async()=>{
 const h=harness(); h.ctx.WLAccountManager={getCachedIdToken:()=> 'test-only'};
 h.ctx.fetch=async()=>{throw new TypeError('Failed to fetch');};
 await assert.rejects(h.probe.request('/api/v1/me')); assert.equal(h.probe.state().networkUnavailable,true); assert.equal(h.probe.state().offlineNoticePending,false);
 h.ctx.fetch=async()=>({ok:true,status:200,json:async()=>({})}); await h.probe.request('/api/v1/me'); assert.equal(h.probe.state().networkUnavailable,false);
});
test('native connectivity supersedes a stale browser offline signal',()=>{
 const h=harness(); h.ctx.AndroidManager={isOnline:()=>true}; h.ctx.navigator.onLine=false;
 h.listeners.offline(); assert.equal(h.probe.state().offlineNoticePending,false);
});
test('foreground transition waits before reconnecting and hidden checks stay quiet',async()=>{
 const h=harness(); h.probe.setCurrent({uid:'test'}); h.ctx.document.hidden=true;
 let calls=0; h.ctx.fetch=async()=>{calls++; throw Error('unexpected request');};
 await h.probe.resumeCloudSync(); h.probe.showOfflineNotice(); assert.equal(calls,0);
 h.ctx.document.hidden=false; h.listeners.visibilitychange(); assert.equal(h.timers.at(-1).delay,5000); assert.equal(calls,0);
});
test('genuine offline episode shows one delayed notice, including after app return',()=>{
 const h=harness(), panels=[]; h.probe.watchPanels(panels);
 h.probe.setCurrent({uid:'test',entitlements:{cloudSave:true,premiumLifetime:true}});
 h.ctx.navigator.onLine=false; h.listeners.offline(); h.probe.showOfflineNotice(); assert.equal(panels.length,0);
 h.advance(6000); h.probe.showOfflineNotice(); assert.equal(panels.length,1);
 h.probe.closePanel(); h.ctx.document.hidden=true; h.advance(10000); h.probe.showOfflineNotice();
 h.ctx.document.hidden=false; h.listeners.visibilitychange(); h.advance(6000); h.probe.showOfflineNotice(); assert.equal(panels.length,1);
});
test('a request finishing after connectivity is lost cannot announce cloud saves ready',async()=>{
 const h=harness(), panels=[]; h.probe.watchPanels(panels); h.advance(6000);
 h.probe.setCurrent({uid:'test',entitlements:{cloudSave:true,premiumLifetime:true}});
 h.ctx.WLAccountManager={getCachedIdToken:()=> 'test-only'};
 h.ctx.fetch=async()=>{h.ctx.navigator.onLine=false;return {ok:true,status:200,json:async()=>({uid:'test',entitlements:{cloudSave:true,premiumLifetime:true}})};};
 await h.probe.resumeCloudSync(); assert.equal(panels.length,0); assert.equal(h.probe.state().networkUnavailable,true);
});
test('failed automatic restore waits for explicit retry despite repeated refresh',async()=>{
 const h=harness(); h.advance(6000); h.probe.setCurrent({uid:'test',entitlements:{cloudSave:true,premiumLifetime:true}});
 h.probe.setActiveProfileId('p'); h.probe.setFailure('test:p');
 assert.equal(await h.probe.checkStartupProfileFreshness(true),'awaiting_retry');
});

async function syncHarness() {
 const h=harness({global:[null,{timestamp:1}],file1:{progress:1}});
 h.probe.setCurrent({uid:'test',entitlements:{cloudSave:true,premiumLifetime:true}});
 h.probe.setActiveProfileId('p'); h.probe.setReady();h.probe.unpause();
 h.probe.saveWorkspaceBinding('p',{revision:'r0',fingerprint:'old',profileName:'Test'});
 const panels=[];h.probe.panels(panels);h.panels=panels;
 return h;
}
function backend(h, initialCloud) {
 let cloud=initialCloud, revision='r0', uploads=0, busy=0, maximum=0;
 const requests=[];
 h.probe.network(async(path,options={})=>{
  requests.push(path);
  if(path.endsWith('/prepare-upload')) {busy++;maximum=Math.max(maximum,busy);return{uploadUrl:'upload',uploadId:'u',baseRevision:options.body.baseRevision};}
  if(path.endsWith('/finalize')) {busy--;uploads++;revision='r'+uploads;return{currentRevision:revision,updatedAt:new Date().toISOString()};}
  if(path.endsWith('/download')) {const bytes=new TextEncoder().encode(JSON.stringify(cloud));return {downloadUrl:'download',manifest:{currentRevision:revision,updatedAt:new Date().toISOString(),byteLength:bytes.length,sha256:Buffer.from(await webcrypto.subtle.digest('SHA-256',bytes)).toString('hex')}};}
  if(path==='/api/v1/cloud-save-profiles') return {profiles:[{profileId:'p',name:'Test',currentRevision:revision}]};
  throw Error(path);
 },async(url,options)=>{
  if(url==='upload'){cloud=JSON.parse(new TextDecoder().decode(options.body));return{ok:true};}
  const bytes=new TextEncoder().encode(JSON.stringify(cloud));return{ok:true,arrayBuffer:async()=>bytes.buffer};
 });
 return {stats:()=>({uploads,maximum,requests}),setRevision:r=>revision=r};
}
test('automatic, retry and manual uploads serialize; identical snapshots create one revision',async()=>{
 const h=await syncHarness(),b=backend(h,bundle([]));h.probe.markProfileDirty('p');
 await Promise.all([h.probe.uploadProfile('p'),h.probe.uploadProfile('p'),h.ctx.WLAccountEntitlements.uploadActiveProfile()]);
 assert.equal(b.stats().uploads,1);assert.equal(b.stats().maximum,1);assert.equal(Object.keys(h.probe.retryQueue()).length,0);
});
test('a save made during upload stays dirty and the following upload includes it',async()=>{
 const h=await syncHarness();let release,entered;const began=new Promise(r=>entered=r);let uploads=0;const payloads=[];
 h.probe.network(async(path)=>path.endsWith('/prepare-upload')?{uploadUrl:'upload',uploadId:'u'}:{currentRevision:'r'+(++uploads),updatedAt:new Date().toISOString()},async(url,options)=>{payloads.push(JSON.parse(new TextDecoder().decode(options.body)));if(payloads.length===1){entered();await new Promise(r=>release=r);}return{ok:true};});
 h.probe.markProfileDirty('p');const first=h.probe.uploadProfile('p');await began;
 await h.ctx.StorageManager.saveObject('file1',{progress:2});release();await first;
 assert(h.probe.retryQueue().p);await h.probe.uploadProfile('p');
 assert.equal(JSON.parse(payloads[1].files.file1).progress,2);assert.equal(Object.keys(h.probe.retryQueue()).length,0);
});
test('lost finalize response with identical cloud data is reconciled without replacement',async()=>{
 const h=await syncHarness();const local=await h.probe.buildProfileBundle('p');const b=backend(h,local);b.setRevision('r2');h.probe.markProfileDirty('p');
 const result=await h.probe.presentProfileConflict('p');
 assert.equal(result.reconciled,true);assert.equal(b.stats().uploads,0);assert.equal(h.probe.workspaceBinding().revision,'r2');assert.equal(h.probe.syncState().startupProfileDecisionPending,false);
});
test('real conflict pauses retries; choosing device saves resolves pause and preserves progress',async()=>{
 const h=await syncHarness(),b=backend(h,bundle([null,{timestamp:2}],{file1:{progress:9}}));b.setRevision('other');
 await h.probe.presentProfileConflict('p');assert.equal(h.probe.syncState().startupProfileDecisionPending,true);
 assert.equal((await h.probe.uploadProfile('p')).conflict,true);assert.equal(b.stats().uploads,0);
 const action=h.panels.at(-1).actions.find(a=>a.label==='Keep this device');await action.run();
 assert.equal(b.stats().uploads,1);assert.equal(h.disk.get('file1').progress,1);assert.equal(h.probe.syncState().startupProfileDecisionPending,false);
});
test('choosing cloud saves restores data and resumes sync with no echo upload',async()=>{
 const h=await syncHarness(),b=backend(h,bundle([null,{timestamp:2}],{file1:{progress:9}}));b.setRevision('other');
 await h.probe.presentProfileConflict('p');await h.panels.at(-1).actions.find(a=>a.label==='Use cloud profile').run();
 assert.equal(h.disk.get('file1').progress,9);assert.equal(h.probe.syncState().startupProfileDecisionPending,false);
 await h.probe.uploadProfile('p');assert.equal(b.stats().uploads,0);
});
function tapButton(h,action){const handlers={};const el={disabled:false,addEventListener:(n,f)=>handlers[n]=f,setAttribute(){},removeAttribute(){}};h.probe.bindReleaseTap(el,action);return{el,send(type,extra={}){handlers[type]?.({cancelable:true,stopPropagation(){},preventDefault(){},...extra});}};}
const touch=(x,y)=>({clientX:x,clientY:y});
test('touch release activates once, synthetic click is suppressed and drag/cancel do not activate',()=>{
 const h=harness();let count=0;const b=tapButton(h,()=>count++);
 b.send('touchstart',{touches:[touch(10,10)]});assert.equal(count,0);
 b.send('touchend',{changedTouches:[touch(10,10)]});b.send('click');assert.equal(count,1);
 h.advance(1000);b.send('touchstart',{touches:[touch(10,10)]});b.send('touchmove',{touches:[touch(10,50)]});b.send('touchend',{changedTouches:[touch(10,50)]});b.send('click');assert.equal(count,1);
 h.advance(1000);b.send('touchstart',{touches:[touch(10,10)]});b.send('touchcancel');b.send('click');assert.equal(count,1);
});
test('pointer-only WebView release works once and rejects dragged gestures',()=>{
 const h=harness();let count=0;const b=tapButton(h,()=>count++),point={pointerId:1,pointerType:'touch',clientX:10,clientY:10,button:0};
 b.send('pointerdown',point);b.send('pointerup',point);b.send('click');assert.equal(count,1);
 h.advance(1000);b.send('pointerdown',point);b.send('pointermove',{...point,clientY:60});b.send('pointerup',{...point,clientY:60});b.send('click');assert.equal(count,1);
});
test('async conflict action is disabled until completion and cannot run twice',async()=>{
 const h=harness();let count=0,release;const b=tapButton(h,()=>{count++;return new Promise(r=>release=r);});
 b.send('click');h.advance(1000);b.send('click');assert.equal(count,1);assert.equal(b.el.disabled,true);release();await new Promise(r=>setImmediate(r));assert.equal(b.el.disabled,false);
});

test('startup downloads a newer cloud revision when local saved content is unchanged',async()=>{
 const h=await syncHarness();const fingerprint=await h.probe.profileFilesFingerprint((await h.probe.buildProfileBundle('p')).files);
 h.probe.saveWorkspaceBinding('p',{fingerprint,localChangedAt:null});
 const b=backend(h,bundle([null,{timestamp:2}],{file1:{progress:9}}));b.setRevision('other');
 const result=await h.probe.checkStartupProfileFreshness(true);
 assert.equal(result,'downloaded');assert.equal(h.disk.get('file1').progress,9);assert.equal(b.stats().uploads,0);
});
test('manual sync reports success after completing one upload',async()=>{
 const h=await syncHarness(),b=backend(h,bundle([]));
 await Promise.all([h.probe.syncFromUi(),h.probe.syncFromUi()]);
 assert.equal(b.stats().uploads,1);assert.equal(h.panels.at(-1).title,'Cloud backup updated');
});
test('snapshot waits for pending slot and global writes',async()=>{
 const h=await syncHarness();let release;
 const original=h.ctx.StorageManager.objectToJson;
 let first=true;
 h.ctx.StorageManager.objectToJson=async object=>{
  if(first){first=false;await h.ctx.StorageManager.saveObject('file1',{progress:3});}
  return original(object);
 };
 const saved=await h.probe.buildProfileBundle('p');assert.equal(JSON.parse(saved.files.file1).progress,3);
});
test('manual sync eligibility requires both sign-in and cloud-save entitlement',()=>{
 const h=harness();const can=()=>h.ctx.WLAccountEntitlements.canSyncCloud();
 h.probe.setCurrent(null);assert.equal(can(),false);
 h.probe.setCurrent({entitlements:{cloudSave:true,premiumLifetime:true}});assert.equal(can(),false);
 h.probe.setCurrent({uid:'test',entitlements:{cloudSave:false,premiumLifetime:true}});assert.equal(can(),false);
 h.probe.setCurrent({uid:'test',entitlements:{cloudSave:true,premiumLifetime:false}});assert.equal(can(),false);
 h.probe.setCurrent({uid:'test',entitlements:{cloudSave:true,premiumLifetime:true}});assert.equal(can(),true);
 h.probe.setCurrent(null);assert.equal(can(),false);
});

