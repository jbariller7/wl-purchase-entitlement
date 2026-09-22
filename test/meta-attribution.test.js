import {expect,it} from 'vitest';
import {metaAttribution,addAttribution} from '../integrations/web/shop/attribution.js';
it('carries the marketing-site cookies through the cross-domain shop and checkout',()=>{
 const marketing=metaAttribution('', '_fbp=fb.1.1700000000000.browser; _fbc=fb.1.1700000000000.click');
 const params=new URLSearchParams();addAttribution(params,marketing);
 expect(metaAttribution('?'+params,'')).toEqual(marketing);
});
it('builds fbc only from a genuine received click ID and preserves its original timestamp across hops',()=>{
 expect(metaAttribution('?fbclid=real_click-1','',1234)).toEqual({fbc:'fb.1.1234.real_click-1'});
 expect(metaAttribution('?fbc=fb.1.1234.real_click-1&fbclid=real_click-1','',5678)).toEqual({fbc:'fb.1.1234.real_click-1'});
 expect(metaAttribution('?fbclid=<invalid>','',1234)).toEqual({});
 expect(metaAttribution('','',1234)).toEqual({});
});
