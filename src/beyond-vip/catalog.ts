export const VIP_FLOW='beyond-vip-reservation-v1';
export const VIP_TERMS='2026-10-22-v1';
// Amounts are integer EUR cents. The US$1 reservation is a separate payment.
export const vipTiers=[
 {id:'supporter',name:'Support the Adventure',normal:500},
 {id:'adventurer',name:'The Adventurer',normal:2900},
 {id:'multiplatform',name:'Multiplatform Adventurer',normal:3900},
 {id:'complete',name:'The Complete Adventure',normal:5400},
 {id:'lifetime',name:'Lifetime Language Pass',normal:7900},
 {id:'citizen',name:'Honorary Citizen',normal:14900},
 {id:'council',name:'Council Member',normal:24900},
 {id:'legend',name:'Legend of WonderLang',normal:39900},
 {id:'master',name:'Game Master',normal:59900},
 {id:'hero',name:'Language Hero',normal:125000},
 {id:'god',name:'Language God',normal:150000}
].map(t=>({...t,vip:t.normal*7/10}));
export function vipTier(id:unknown){return vipTiers.find(t=>t.id===id);}
