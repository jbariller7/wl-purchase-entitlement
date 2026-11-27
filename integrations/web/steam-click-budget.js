// Suppress repeated identical placement/cohort clicks before they consume a
// function request. New ads/placements still produce distinct observations.
export function createClickBudget(storage, now=()=>Date.now()) {
 const key='wl_steam_click_budget',windowMs=30*60*1000;
 let entries=[];try{const saved=JSON.parse(storage?.getItem(key)||'[]');if(Array.isArray(saved))entries=saved.filter(x=>Array.isArray(x)&&typeof x[0]==='string'&&Number.isFinite(x[1])).slice(-100)}catch{}
 const persist=()=>{try{storage?.setItem(key,JSON.stringify(entries))}catch{}};
 return {
  reserve(identity){const at=now();entries=entries.filter(x=>x[1]<=at&&at-x[1]<windowMs);if(entries.some(x=>x[0]===identity))return null;entries.push([identity,at]);entries=entries.slice(-100);persist();return {identity,at};},
  release(ticket){entries=entries.filter(x=>x[0]!==ticket.identity||x[1]!==ticket.at);persist();},
  clear(){entries=[];try{storage?.removeItem(key)}catch{}}
 };
}
