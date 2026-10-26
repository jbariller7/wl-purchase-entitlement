import {describe,it,expect,vi} from 'vitest';
import {createSalesRefresh} from '../integrations/web/shop/sales-refresh.js';
describe('shop refresh scheduling',()=>{
 it('caps old thirty-minute feed hints to one minute despite focus and timer events',async()=>{
  let time=0;const load=vi.fn(async()=>1800);
  const refresh=createSalesRefresh({load,now:()=>time,visible:()=>true,online:()=>true});
  await refresh();for(time=1000;time<60000;time+=1000)await refresh();
  expect(load).toHaveBeenCalledTimes(1);await refresh();expect(load).toHaveBeenCalledTimes(2);
 });
 it('does not fetch while hidden or offline, and resumes when due',async()=>{
  let visible=false,online=true;const load=vi.fn(async()=>1800);
  const refresh=createSalesRefresh({load,visible:()=>visible,online:()=>online});
  await refresh();visible=true;online=false;await refresh();expect(load).not.toHaveBeenCalled();
  online=true;await refresh();expect(load).toHaveBeenCalledTimes(1);
 });
 it('coalesces concurrent requests and respects shorter remaining cache lifetimes',async()=>{
  let finish;let time=0;const load=vi.fn(()=>new Promise(r=>{finish=r}));
  const refresh=createSalesRefresh({load,now:()=>time,visible:()=>true,online:()=>true});
  const first=refresh();refresh();refresh();expect(load).toHaveBeenCalledTimes(1);finish(45);await first;
  time=44000;await refresh();expect(load).toHaveBeenCalledTimes(1);
  time=45000;const next=refresh();finish(1800);await next;expect(load).toHaveBeenCalledTimes(2);
 });
 it('backs off on failures without treating an error as a successful cache entry',async()=>{
  let time=0;const load=vi.fn(async()=>{throw Error('offline')});
  const refresh=createSalesRefresh({load,now:()=>time,visible:()=>true,online:()=>true});
  await refresh();time=59000;await refresh();expect(load).toHaveBeenCalledTimes(1);
  time=60000;await refresh();time=179000;await refresh();expect(load).toHaveBeenCalledTimes(2);
  time=180000;await refresh();expect(load).toHaveBeenCalledTimes(3);
 });
});
