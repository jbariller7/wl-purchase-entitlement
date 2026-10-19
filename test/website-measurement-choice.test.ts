import {afterEach,describe,expect,it,vi} from 'vitest';
// @ts-expect-error Browser helper intentionally uses plain JS.
import {marketingAllowed} from '../integrations/web/shop/checkout-attribution.js';
afterEach(()=>vi.unstubAllGlobals());
describe('website measurement choice at checkout',()=>{
 const setup=(choice:string|null)=>{
  vi.stubGlobal('navigator',{globalPrivacyControl:false});
  vi.stubGlobal('window',{});
  vi.stubGlobal('localStorage',{getItem:()=>choice});
 };
 it('honours a refusal on every same-origin checkout, including older homepage versions',()=>{
  setup('no');expect(marketingAllowed('')).toBe(false);expect(marketingAllowed('?fbclid=realClick')).toBe(false);
 });
 it('allows the accepted path without overriding explicit opt-out or GPC',()=>{
  setup('yes');expect(marketingAllowed('')).toBe(true);expect(marketingAllowed('?metaOptOut=1')).toBe(false);
  vi.stubGlobal('navigator',{globalPrivacyControl:true});expect(marketingAllowed('')).toBe(false);
 });
 it('preserves standalone shop behaviour when no homepage choice exists',()=>{
  setup(null);expect(marketingAllowed('')).toBe(true);
 });
});
