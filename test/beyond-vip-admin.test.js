import {describe,it,expect,vi} from 'vitest';
import {allFilteredVipRecords,vipCsv,vipFilterQuery,renderVip} from '../integrations/web/admin-console/beyond-vip.js';
describe('VIP administrator filters and export',()=>{
 it('preserves reward, payment status and email filters on every export page, including empty pages',async()=>{
  const api=vi.fn().mockResolvedValueOnce({reservations:[],nextCursor:'cs_live_first'}).mockResolvedValueOnce({reservations:[{id:'cs_live_match',email:'buyer@example.com',tierId:'hero'}],nextCursor:'cs_live_second'}).mockResolvedValueOnce({reservations:[{id:'cs_live_last',email:'second@example.com',tierId:'hero'}],nextCursor:null});
  const filters={tier:'hero',state:'paid',q:'example.com'},rows=await allFilteredVipRecords(api,filters);
  expect(rows).toHaveLength(2);expect(api).toHaveBeenCalledTimes(3);
  for(const [url] of api.mock.calls){const params=new URL(url,'https://wonderlang.app').searchParams;expect(params.get('tier')).toBe('hero');expect(params.get('state')).toBe('paid');expect(params.get('q')).toBe('example.com')}
  expect(api.mock.calls[2][0]).toContain('cursor=cs_live_second');
 });
 it('deduplicates records during an export and stops instead of looping on a broken cursor',async()=>{
  const api=vi.fn().mockResolvedValue({reservations:[{id:'cs_live_once'}],nextCursor:'cs_live_stuck'});
  await expect(allFilteredVipRecords(api,{tier:'adventurer'})).rejects.toThrow(/did not advance/);
  expect(api).toHaveBeenCalledTimes(2);
 });
 it('quotes CSV fields, preserves tier and payment identity, and neutralizes spreadsheet formulas',()=>{
  const csv=vipCsv([{email:' =HYPERLINK("bad")',tierId:'adventurer',tierName:'A, B',stripePaymentIntentId:'pi_paid',state:'paid'}]);
  expect(csv).toContain('"\' =HYPERLINK(""bad"")"');expect(csv).toContain('"A, B"');expect(csv).toContain('"pi_paid"');expect(csv).toContain('tierId');
 });
 it('renders all reward filter choices, including a separate refunded status',()=>{
  const html=renderVip({filters:{tier:'god'},tiers:[{id:'adventurer',name:'The Adventurer'},{id:'god',name:'Language God'}]});
  expect(html).toContain('value="god" selected');expect(html).toContain('name="state"');expect(html).toContain('Export all matching reservations');expect(html).toContain('value="refunded"');
 });
 it('encodes email search text without changing the filter or cursor',()=>{
  const p=new URLSearchParams(vipFilterQuery({tier:'hero',q:'a+b@example.com'},'cs_live_next').slice(1));expect(p.get('q')).toBe('a+b@example.com');expect(p.get('cursor')).toBe('cs_live_next');
 });
});
