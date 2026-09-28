import {expect,it} from 'vitest';
import {metaAttribution,addAttribution,captureMetaAttribution} from '../integrations/web/shop/checkout-attribution.js';
it('carries the marketing-site cookies through the cross-domain shop and checkout',()=>{
 const marketing=metaAttribution('', '_fbp=fb.1.1700000000000.browser; _fbc=fb.1.1700000000000.click');
 const params=new URLSearchParams();addAttribution(params,marketing);
 expect(metaAttribution('?'+params,'')).toEqual(marketing);
});
it('reads cookies without assuming a space after each separator',()=>{
 expect(metaAttribution('','other=1;_fbp=fb.1.123.browser;  _fbc=fb.1.123.click')).toEqual({fbp:'fb.1.123.browser',fbc:'fb.1.123.click'});
});
it('keeps genuine click identifiers across cancellation/reloads, refreshes late cookies, and expires saved context',()=>{
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 expect(captureMetaAttribution('?fbclid=click','',storage,1000)).toEqual({fbc:'fb.1.1000.click'});
 expect(captureMetaAttribution('?fbclid=click','',storage,1500)).toEqual({fbc:'fb.1.1000.click'});
 expect(captureMetaAttribution('','_fbp=fb.1.2000.browser',storage,2000)).toEqual({fbp:'fb.1.2000.browser',fbc:'fb.1.1000.click'});
 expect(captureMetaAttribution('','',storage,3000)).toEqual({fbp:'fb.1.2000.browser',fbc:'fb.1.1000.click'});
 expect(captureMetaAttribution('','_fbc=fb.1.900.older',storage,3000).fbc).toBe('fb.1.1000.click');
 expect(captureMetaAttribution('','',storage,3000+86400001)).toEqual({});
 expect(captureMetaAttribution('?fbclid=click','',storage,4000,false)).toEqual({});expect(data.size).toBe(0);
});
it('keeps checkout usable when browser storage is unavailable',()=>{
 const storage={getItem:()=>{throw Error('blocked')},setItem:()=>{throw Error('blocked')}};
 expect(captureMetaAttribution('?fbclid=click','',storage,1000)).toEqual({fbc:'fb.1.1000.click'});
});
it('builds fbc only from a genuine received click ID and preserves its original timestamp across hops',()=>{
 expect(metaAttribution('?fbclid=real_click-1','',1234)).toEqual({fbc:'fb.1.1234.real_click-1'});
 expect(metaAttribution('?fbc=fb.1.1234.real_click-1&fbclid=real_click-1','',5678)).toEqual({fbc:'fb.1.1234.real_click-1'});
 expect(metaAttribution('?fbclid=<invalid>','',1234)).toEqual({});
 expect(metaAttribution('','',1234)).toEqual({});
});
