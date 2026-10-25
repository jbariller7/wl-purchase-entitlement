import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({allowed:vi.fn(),load:vi.fn(),cookies:vi.fn()}));
vi.mock('../integrations/web/shop/checkout-attribution.js',()=>({marketingAllowed:mocks.allowed}));
vi.mock('../integrations/web/shop/purchase-tracking.js',()=>({loadMetaPixel:mocks.load,restoreMetaCookies:mocks.cookies}));
let tracking;
beforeEach(async()=>{
 vi.resetModules();vi.clearAllMocks();mocks.allowed.mockReturnValue(true);mocks.load.mockResolvedValue();
 vi.stubGlobal('window',{fbq:vi.fn()});vi.stubGlobal('document',{});vi.stubGlobal('location',{search:''});
 tracking=await import('../integrations/web/beyond-vip/tracking.js');
});
afterEach(()=>vi.unstubAllGlobals());
const conversion=()=>({eventName:'Purchase',eventId:'beyond-vip:cs_live_verified123',pixelId:'552284573796131',value:1,currency:'USD',product:'WonderLang_Beyond_VIP_adventurer',eventTime:Math.floor(Date.now()/1000),emailSha256:'a'.repeat(64)});
it('sends PageView once and InitiateCheckout without reporting a Purchase',async()=>{
 await tracking.vipFunnel('PageView');await tracking.vipFunnel('PageView');await tracking.vipFunnel('InitiateCheckout',{value:1,currency:'USD'});
 expect(window.fbq.mock.calls.filter(c=>c[0]==='trackSingle').map(c=>c[2])).toEqual(['PageView','InitiateCheckout']);
});
it('uses the server Purchase event ID and suppresses immediate retries',async()=>{
 const c=conversion();expect(await tracking.vipPurchase(c)).toBe(true);expect(await tracking.vipPurchase(c)).toBe(false);
 expect(window.fbq).toHaveBeenCalledWith('trackSingle',c.pixelId,'Purchase',{value:1,currency:'USD',content_ids:[c.product],content_type:'product'},{eventID:c.eventId});
 expect(window.fbq.mock.calls.filter(c=>c[2]==='Purchase')).toHaveLength(1);
});
it.each(['token','session_id'])('does not load Meta if a private %s remains in the URL',async key=>{
 location.search='?'+key+'=private';expect(await tracking.vipPurchase(conversion())).toBe(false);expect(mocks.load).not.toHaveBeenCalled();
});
it('honors withdrawal before and while loading the pixel',async()=>{
 mocks.allowed.mockReturnValue(false);await tracking.vipPurchase(conversion());await tracking.vipFunnel('PageView');expect(mocks.load).not.toHaveBeenCalled();
 mocks.allowed.mockReturnValue(true);mocks.load.mockImplementation(async()=>{mocks.allowed.mockReturnValue(false)});
 expect(await tracking.vipPurchase(conversion())).toBe(false);expect(window.fbq).not.toHaveBeenCalled();
});
it('fails safely when the pixel is blocked and permits a later retry',async()=>{
 mocks.load.mockRejectedValueOnce(new Error('blocked'));expect(await tracking.vipPurchase(conversion())).toBe(false);
 mocks.load.mockResolvedValue();expect(await tracking.vipPurchase(conversion())).toBe(true);
});
it.each([{value:2030},{currency:'EUR'},{eventId:'cs_live_wrong'},{eventTime:1},{pixelId:'123'}])('rejects mismatched or stale conversion data %j',async changed=>{
 expect(await tracking.vipPurchase({...conversion(),...changed})).toBe(false);expect(mocks.load).not.toHaveBeenCalled();
});
