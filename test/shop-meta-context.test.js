import {afterEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({load:vi.fn(),restore:vi.fn()}));
vi.mock('../integrations/web/shop/purchase-tracking.js',()=>({loadMetaPixel:mocks.load,restoreMetaCookies:mocks.restore}));
import {ensureShopMetaContext} from '../integrations/web/shop/shop-meta-context.js';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.clearAllMocks()});
function browser(search='?fbclid=realclick'){
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const document={cookie:''},window={fbq:vi.fn((...args)=>{if(args[0]==='trackSingle')document.cookie='_fbp=fb.1.123.issuedByMeta'})};window.parent=window;
 vi.stubGlobal('location',{search});vi.stubGlobal('navigator',{});vi.stubGlobal('localStorage',storage);vi.stubGlobal('sessionStorage',storage);vi.stubGlobal('window',window);vi.stubGlobal('document',document);
 return {window,document,data};
}
it('captures the genuine SDK-issued browser cookie for a direct sale link without losing its original click',async()=>{
 const b=browser();mocks.load.mockResolvedValue();const result=await ensureShopMetaContext();
 expect(result.fbp).toBe('fb.1.123.issuedByMeta');expect(result.fbc).toMatch(/^fb\.1\.\d+\.realclick$/);
 expect(b.window.fbq).toHaveBeenCalledWith('trackSingle','552284573796131','PageView');
 expect(b.window.fbq.mock.calls.some(x=>x.includes('Purchase'))).toBe(false);
});
it('does not lose known click context when Meta is blocked',async()=>{
 browser();mocks.load.mockRejectedValue(Error('blocked'));
 expect((await ensureShopMetaContext()).fbc).toMatch(/\.realclick$/);
 expect(mocks.load).toHaveBeenCalledWith(window,document);
});
it('does not load the Pixel for an opted-out visitor or an embedded game shop',async()=>{
 const b=browser('?fbclid=realclick&metaOptOut=1');expect(await ensureShopMetaContext()).toEqual({});expect(mocks.load).not.toHaveBeenCalled();
 location.search='?fbclid=realclick';b.window.parent={};await ensureShopMetaContext();expect(mocks.load).not.toHaveBeenCalled();
});
it('allows checkout to continue while a slow Pixel finishes instead of removing its script at 1.5s',async()=>{
 vi.useFakeTimers();const win={fbq:vi.fn()};win.parent=win;
 vi.stubGlobal('window',win);vi.stubGlobal('document',{cookie:''});vi.stubGlobal('navigator',{});vi.stubGlobal('location',{search:''});
 let ready;mocks.load.mockReturnValue(new Promise(resolve=>{ready=resolve}));
 const result=ensureShopMetaContext();await vi.advanceTimersByTimeAsync(1500);expect(await result).toEqual({});
 expect(mocks.load).toHaveBeenCalledWith(win,document);expect(win.fbq).not.toHaveBeenCalled();
 ready();await vi.advanceTimersByTimeAsync(1);
 expect(win.fbq).toHaveBeenCalledWith('init','552284573796131');
});
