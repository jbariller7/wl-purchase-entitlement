import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../integrations/web/beyond-vip/attribution.js',import.meta.url),'utf8').replace(/^import .*;$/m,'').replace('export function','function');
it('carries available ad identifiers on both reward lists and clears them on opt-out',()=>{
 let allowed=true;const handlers={};
 const links=['adventurer','god'].map(tier=>({href:'https://wonderlang.app/.netlify/functions/beyond-vip?tier='+tier}));
 const capture=vi.fn(()=>allowed?{fbc:'fb.1.123.click',fbp:'fb.1.123.browser'}:{});
 vm.runInNewContext(source,{URL,location:{origin:'https://wonderlang.app',href:'https://wonderlang.app/beyondmockup/'},browserMetaAttribution:capture,marketingAllowed:()=>allowed,addAttribution:(params,context)=>Object.entries(context).forEach(([k,v])=>params.set(k,v)),document:{querySelectorAll:()=>links,addEventListener:(name,fn)=>handlers[name]=fn},window:{addEventListener:(name,fn)=>handlers[name]=fn}});
 for(const a of links){expect(new URL(a.href).searchParams.get('fbc')).toBe('fb.1.123.click');expect(new URL(a.href).searchParams.has('tier')).toBe(true);}
 allowed=false;handlers.click();
 for(const a of links){const p=new URL(a.href).searchParams;expect(p.get('metaOptOut')).toBe('1');expect(p.has('fbc')).toBe(false);expect(p.has('fbp')).toBe(false);}
 expect(capture).toHaveBeenCalledTimes(2);
});
