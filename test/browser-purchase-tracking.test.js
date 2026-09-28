import {afterEach,expect,it,vi} from 'vitest';
import {verifiedConversion,reportMetaPurchase,loadMetaPixel} from '../integrations/web/shop/purchase-tracking.js';
const sessionId='cs_live_example';
const conversion={transactionId:sessionId,value:41.99,currency:'USD',meta:{pixelId:'552284573796131',eventId:sessionId,eventName:'Purchase',product:'premium',emailSha256:'a'.repeat(64)}};
afterEach(()=>vi.useRealTimers());
it('waits for the measured 3.3-second production verification instead of cancelling at 2 seconds',async()=>{
 vi.useFakeTimers();
 const fetcher=vi.fn((_,options)=>new Promise((resolve,reject)=>{
  options.signal.addEventListener('abort',()=>reject(new Error('aborted')));
  setTimeout(()=>resolve({ok:true,json:async()=>({conversion})}),3300);
 }));
 const result=verifiedConversion(sessionId,'secret',{fetcher});
 await vi.advanceTimersByTimeAsync(3300);
 expect(await result).toEqual(conversion);expect(fetcher).toHaveBeenCalledTimes(1);
});
it('retries temporary network/server errors with the same purchase and secret',async()=>{
 const fetcher=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ok:false,status:503}).mockResolvedValueOnce({ok:true,json:async()=>({conversion})});
 expect(await verifiedConversion(sessionId,'secret',{fetcher,wait:async()=>{}})).toEqual(conversion);
 expect(new Set(fetcher.mock.calls.map(x=>x[1].body)).size).toBe(1);
});
it('does not retry rejected ownership or report a different/free purchase',async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:false,status:404});
 expect(await verifiedConversion(sessionId,'secret',{fetcher})).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);
 for(const bad of [{...conversion,transactionId:'cs_live_other'},{...conversion,value:0}])expect(await verifiedConversion(sessionId,'secret',{fetcher:async()=>({ok:true,json:async()=>({conversion:bad})})})).toBeNull();
});
function browser(){const values=new Map();return {fbq:vi.fn(),localStorage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)}};}
it('leaves blocked pixel loads retryable and sends one browser event with the server ID',async()=>{
 const win=browser(),load=vi.fn().mockRejectedValueOnce(new Error('blocked')).mockResolvedValue(undefined);
 const options={win,doc:{},nav:{},load};
 expect(await reportMetaPurchase(conversion,options)).toBe(false);
 expect(win.localStorage.getItem('wl-meta-purchase:'+sessionId)).toBeUndefined();
 expect(await reportMetaPurchase(conversion,options)).toBe(true);
 expect(await reportMetaPurchase(conversion,options)).toBe(false);
 expect(win.fbq.mock.calls.filter(x=>x[0]==='trackSingle')).toEqual([['trackSingle','552284573796131','Purchase',{value:41.99,currency:'USD',content_ids:['premium'],content_type:'product'},{eventID:sessionId}]]);
});
it('does not send duplicate events from overlapping retries, including with blocked storage',async()=>{
 const win=browser();win.localStorage.getItem=()=>{throw Error('blocked')};win.localStorage.setItem=()=>{throw Error('blocked')};
 let resolve;const load=()=>new Promise(r=>{resolve=r});const options={win,doc:{},nav:{},load};
 const first=reportMetaPurchase(conversion,options);
 expect(await reportMetaPurchase(conversion,options)).toBe(false);resolve();expect(await first).toBe(true);
 expect(await reportMetaPurchase(conversion,options)).toBe(false);
});
it('respects opt-out both before and after loading the pixel',async()=>{
 const win=browser(),load=vi.fn();
 expect(await reportMetaPurchase(conversion,{win,doc:{},nav:{globalPrivacyControl:true},load})).toBe(false);expect(load).not.toHaveBeenCalled();
 expect(await reportMetaPurchase(conversion,{win,doc:{},nav:{},load:async()=>{win.wlMarketingConsent=false}})).toBe(false);expect(win.fbq).not.toHaveBeenCalled();
});
it('cleans up failed script loads so a later attempt can load the pixel',async()=>{
 const scripts=[],win={},doc={createElement:()=>({remove:vi.fn()}),head:{append:s=>scripts.push(s)}};
 const first=loadMetaPixel(win,doc);const caught=expect(first).rejects.toThrow('unavailable');scripts[0].onerror();await caught;
 const second=loadMetaPixel(win,doc);expect(scripts).toHaveLength(2);win.fbq.callMethod=vi.fn();scripts[1].onload();await second;
});
