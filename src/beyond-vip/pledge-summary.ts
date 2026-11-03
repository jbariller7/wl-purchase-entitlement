import type {Firestore} from 'firebase-admin/firestore';
import {vipTiers} from './catalog.js';

export function summarizeVipPledges(records: Array<{state?:unknown;eligible?:unknown;tierId?:unknown}>) {
 const tiers=vipTiers.map(t=>({id:t.id,name:t.name,vipEurCents:t.vip,bookings:0,totalEurCents:0}));
 let unpricedBookings=0;
 for(const record of records){
  if(record.state!=='paid'||record.eligible!==true)continue;
  const tier=tiers.find(t=>t.id===record.tierId);
  if(!tier){unpricedBookings++;continue;}
  tier.bookings++;tier.totalEurCents+=tier.vipEurCents;
 }
 return {currency:'EUR',totalEurCents:tiers.reduce((n,t)=>n+t.totalEurCents,0),bookings:tiers.reduce((n,t)=>n+t.bookings,0),unpricedBookings,tiers};
}

export async function vipPledgeSummary(db:Firestore){
 // No list pagination or UI filters: the estimate covers the entire campaign.
 // Project only the fields needed for calculation, never customer identifiers.
 const snapshot=await db.collection('beyondVipReservations').where('state','==','paid').select('state','eligible','tierId').get();
 return {...summarizeVipPledges(snapshot.docs.map(d=>d.data())),calculatedAt:new Date().toISOString()};
}
