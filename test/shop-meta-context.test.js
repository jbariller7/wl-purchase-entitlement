import {afterEach,expect,it,vi} from 'vitest';
const loader=vi.hoisted(()=>vi.fn());
vi.mock('../integrations/web/shop/purchase-tracking.js',()=>({loadMetaPixel:loader}));
import {ensureShopMetaContext} from '../integrations/web/shop/shop-meta-context.js';
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks()});
function browser(search='?fbclid=realclick'){
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const document={cookie:''},window={fbq:vi.fn((...args)=>{if(args[0]==='trackSingle')document.cookie='_fbp=fb.1.123.issuedByMeta'})};window.parent=window;
 vi.stubGlobal('location',{search});vi.stubGlobal('navigator',{});vi.stubGlobal('localStorage',storage);vi.stubGlobal('sessionStorage',storage);vi.stubGlobal('window',window);vi.stubGlobal('document',document);
 return {window,document,data};
}
it('captures the genuine SDK-issued browser cookie for a direct sale link without losing its original click',async()=>{
 const b=browser();loader.mockResolvedValue();const result=await ensureShopMetaContext();
 expect(result.fbp).toBe('fb.1.123.issuedByMeta');expect(result.fbc).toMatch(/^fb\.1\.\d+\.realclick$/);
 expect(b.window.fbq).toHaveBeenCalledWith('trackSingle','552284573796131','PageView');
 expect(b.window.fbq.mock.calls.some(x=>x.includes('Purchase'))).toBe(false);
});
it('does not delay or lose known click context when Meta is blocked',async()=>{
 browser();loader.mockRejectedValue(Error('blocked'));
 expect((await ensureShopMetaContext()).fbc).toMatch(/\.realclick$/);
 expect(loader).toHaveBeenCalledWith(window,document,1500);
});
it('does not load the Pixel for an opted-out visitor or an embedded game shop',async()=>{
 const b=browser('?fbclid=realclick&metaOptOut=1');expect(await ensureShopMetaContext()).toEqual({});expect(loader).not.toHaveBeenCalled();
 location.search='?fbclid=realclick';b.window.parent={};await ensureShopMetaContext();expect(loader).not.toHaveBeenCalled();
});
