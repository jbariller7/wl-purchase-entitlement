import {describe,it,expect} from 'vitest';
import {listVipReservations} from '../src/beyond-vip/service.js';
function fixture(){
 const docs=Array.from({length:205},(_,i)=>({id:'cs_live_record'+i,data:()=>({email:'buyer'+i+'@example.com',tierId:i<100?'adventurer':'hero',state:i%2?'refunded':'paid'})}));
 let start=0;
 const query:any={orderBy:()=>query,limit:()=>query,startAfter:(d:any)=>{start=docs.findIndex(x=>x.id===d.id)+1;return query},get:async()=>({docs:docs.slice(start,start+101)}),doc:(id:string)=>({get:async()=>({exists:docs.some(d=>d.id===id),id})})};
 return {db:{collection:()=>query} as any};
}
describe('Private VIP reward filtering',()=>{
 it('advances an empty filtered page and finds the selected tier on later pages',async()=>{
  const f=fixture(),first=await listVipReservations(f.db,undefined,{tier:'hero',state:'paid'});
  expect(first.reservations).toHaveLength(0);expect(first.nextCursor).toBe('cs_live_record99');
  const next=await listVipReservations(f.db,first.nextCursor!,{tier:'hero',state:'paid'});
  expect(next.reservations).toHaveLength(50);expect(next.reservations.every((r:any)=>r.tierId==='hero'&&r.state==='paid')).toBe(true);expect(next.nextCursor).toBe('cs_live_record199');
 });
 it('supports case-insensitive email search without exposing other matching-page records',async()=>{
  const result=await listVipReservations(fixture().db,undefined,{q:'BUYER24@EXAMPLE.COM'});expect(result.reservations).toHaveLength(1);expect(result.reservations[0]?.id).toBe('cs_live_record24');
 });
 it('rejects removed rewards, unknown statuses and invalid cursors',async()=>{
  const f=fixture();await expect(listVipReservations(f.db,undefined,{tier:'early'})).rejects.toThrow(/Unknown reward/);await expect(listVipReservations(f.db,undefined,{state:'anything'})).rejects.toThrow(/Unknown payment/);await expect(listVipReservations(f.db,'../bad')).rejects.toThrow(/Invalid cursor/);
 });
});
