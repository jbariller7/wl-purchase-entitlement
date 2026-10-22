import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/beyondmockup/reserved.js',import.meta.url),'utf8');
const target='https://www.kickstarter.com/projects/jonathan-wonderlang/wonderlang-beyond-a-language-learning-rpg-for-intermediates';
async function page(data,{search='?session_id=cs_live_fixture&token=fixture',ok=true}={}){
 const elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{hidden:true,textContent:'',listeners:{},addEventListener(event,fn){this.listeners[event]=fn;}});return elements.get(id);};
 const pending=new Map();let sequence=0;
 const replace=vi.fn(),fetch=vi.fn().mockResolvedValue({ok,json:async()=>data});
 runInNewContext(source,{document:{getElementById:element},location:{search,replace},URLSearchParams,encodeURIComponent,fetch,
  setTimeout(fn,delay){expect(delay).toBe(1000);pending.set(++sequence,fn);return sequence;},clearTimeout(id){pending.delete(id);}});
 for(let i=0;i<10;i++)await Promise.resolve();
 return {element,replace,fetch,pending,tick(){const [id,fn]=pending.entries().next().value;pending.delete(id);fn();}};
}
describe('Verified VIP return page',()=>{
 it('thanks only a verified paid buyer, then redirects to the exact Kickstarter page after eight seconds',async()=>{
  const p=await page({eligible:true,state:'paid',tierName:'The Adventurer'});
  expect(p.element('reservation-title').textContent).toMatch(/Thank you/);
  expect(p.element('reservation-next').hidden).toBe(false);
  expect(p.element('reservation-status').textContent).toMatch(/saved/);
  for(let i=0;i<7;i++)p.tick();
  expect(p.replace).not.toHaveBeenCalled();p.tick();expect(p.replace).toHaveBeenCalledExactlyOnceWith(target);
 });
 it.each(['pending','refunded','disputed','expired'])('never redirects a %s reservation',async state=>{
  const p=await page({eligible:false,state});
  expect(p.pending.size).toBe(0);expect(p.element('reservation-next').hidden).toBe(true);expect(p.element('reservation-retry').hidden).toBe(false);
 });
 it('does not trust a success-looking query string without the private checkout credentials',async()=>{
  const p=await page({eligible:true,state:'paid'},{search:'?success=true'});
  expect(p.fetch).not.toHaveBeenCalled();expect(p.pending.size).toBe(0);expect(p.element('reservation-title').textContent).toMatch(/could not confirm/);
 });
 it('requires both paid state and true eligibility, even in an inconsistent response',async()=>{
  const p=await page({eligible:true,state:'refunded'});expect(p.pending.size).toBe(0);expect(p.element('reservation-next').hidden).toBe(true);
 });
 it('keeps failed status requests on the page without claiming payment succeeded',async()=>{
  const p=await page({error:'Verification unavailable'},{ok:false});expect(p.pending.size).toBe(0);expect(p.element('reservation-title').textContent).toMatch(/could not confirm/);
 });
 it('lets a buyer pause the redirect to read their reservation information',async()=>{
  const p=await page({eligible:true,state:'paid',tierName:'The Adventurer'});
  p.tick();p.element('reservation-stay').listeners.click();
  expect(p.pending.size).toBe(0);expect(p.replace).not.toHaveBeenCalled();expect(p.element('reservation-countdown').textContent).toMatch(/paused/);
 });
});
