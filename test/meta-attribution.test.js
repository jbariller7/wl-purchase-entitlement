import {expect,it} from 'vitest';
import {metaAttribution,addAttribution,captureMetaAttribution} from '../integrations/web/shop/checkout-attribution.js';
it('keeps long genuine click IDs intact through every shop hop',()=>{
 const click='A'.repeat(650)+'_aem_example',attribution=metaAttribution('?fbclid='+click,'',1234);
 expect(attribution.fbc).toBe('fb.1.1234.'+click);
 const params=new URLSearchParams();addAttribution(params,attribution);
 expect(metaAttribution(params.toString(),'')).toEqual(attribution);
 expect(metaAttribution('?fbclid='+('A'.repeat(5000)),'')).toEqual({});
});
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
 expect(captureMetaAttribution('','',storage,3000+90*86400000+1)).toEqual({});
 expect(captureMetaAttribution('?fbclid=click','',storage,4000,false)).toEqual({});expect(data.size).toBe(0);
});
it('preserves the original marketing browser ID across another domain, a new tab and a later visit',()=>{
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const source=captureMetaAttribution('?fbclid=original','_fbp=fb.1.1000.marketing',storage,1000);
 expect(source).toEqual({fbp:'fb.1.1000.marketing',fbc:'fb.1.1000.original'});
 expect(captureMetaAttribution('','_fbp=fb.1.2000.checkout',storage,2*86400000)).toEqual(source);
 expect(captureMetaAttribution('?fbclid=newclick','_fbp=fb.1.2000.checkout',storage,3*86400000)).toEqual({...source,fbc:`fb.1.${3*86400000}.newclick`});
 expect(captureMetaAttribution('?fbp=fb.1.3000.explicit','',storage,3*86400000+1).fbp).toBe('fb.1.3000.explicit');
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
