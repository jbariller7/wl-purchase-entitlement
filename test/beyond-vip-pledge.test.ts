import {describe,it,expect} from 'vitest';
import {summarizeVipPledges,vipPledgeSummary} from '../src/beyond-vip/pledge-summary.js';
import {vipTiers} from '../src/beyond-vip/catalog.js';
import rewards from '../public/beyondmockup/rewards.json';
import {renderPledgeSummary} from '../integrations/web/admin-console/beyond-vip.js';
describe('VIP pledge estimate',()=>{
 it('matches every published discounted reward price',()=>{
  for(const tier of rewards.tiers)expect(vipTiers.find(t=>t.id===tier.id)?.vip).toBe(tier.vipPriceCents);
  expect(rewards.tiers).toHaveLength(vipTiers.length);
 });
 it('counts all eligible bookings beyond the first page, excluding refunds and disputes',()=>{
  const summary=summarizeVipPledges([...Array.from({length:205},()=>({tierId:'adventurer',state:'paid',eligible:true})),{tierId:'god',state:'paid',eligible:true},{tierId:'hero',state:'refunded',eligible:true},{tierId:'hero',state:'disputed',eligible:true},{tierId:'hero',state:'paid',eligible:false}]);
  expect(summary.bookings).toBe(206);expect(summary.totalEurCents).toBe(205*2030+105000);
  const html=renderPledgeSummary(summary);expect(html).toContain('TOTAL PLEDGE');expect(html).toContain('€5,211.50');expect(html).toContain('regardless of the filters');
 });
 it('shows zero for no bookings and flags unknown tiers rather than guessing a price',()=>{
  expect(summarizeVipPledges([]).totalEurCents).toBe(0);
  const s=summarizeVipPledges([{tierId:'removed',state:'paid',eligible:true}]);expect(s.unpricedBookings).toBe(1);expect(renderPledgeSummary(s)).toContain('unknown tier');
 });
 it('reads the full eligible inventory without a page limit or customer data',async()=>{
  const query:any={where:(field:string,op:string,value:string)=>{expect([field,op,value]).toEqual(['state','==','paid']);return query;},select:(...fields:string[])=>{expect(fields).toEqual(['state','eligible','tierId']);return query;},get:async()=>({docs:[{data:()=>({tierId:'lifetime',state:'paid',eligible:true})}]})};
  const result=await vipPledgeSummary({collection:(name:string)=>{expect(name).toBe('beyondVipReservations');return query;}} as any);
  expect(result.totalEurCents).toBe(5530);
 });
});
