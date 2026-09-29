import {metaAttribution as parseMetaAttribution} from './attribution.js';
export {addAttribution} from './attribution.js';
export function metaAttribution(search, cookies = '', now = Date.now()) {
 return parseMetaAttribution(search,cookies.split(';').map(x=>x.trim()).join('; '),now);
}

// Preserve only real, already available identifiers through reloads and Stripe
// cancellation and new tabs. Never invent a Facebook click or browser ID.
export const META_CONTEXT_KEY='wl-meta-context-v1';
export function captureMetaAttribution(search, cookies, storage, now=Date.now(), allowed=true) {
 const key=META_CONTEXT_KEY;
 if(!allowed){try{storage?.removeItem(key)}catch{}return {};}
 let saved={};
 try {const entry=JSON.parse(storage?.getItem(key)||'null');
  if(entry&&entry.expires>now)saved=metaAttribution(new URLSearchParams(entry.values).toString());
 }catch{}
 const fresh=metaAttribution(search,cookies,now);
 const explicit=metaAttribution(search,'',now);
 // The parent site's browser ID must survive a different cookie on the
 // checkout domain. Explicit incoming context wins, then the retained ID.
 const result={...fresh,...saved,...explicit};
 if(fresh.fbc)result.fbc=fresh.fbc;
 // A late cookie write must not replace a more recent genuine ad click.
 if(saved.fbc&&fresh.fbc&&(saved.fbc.split('.').slice(3).join('.')===fresh.fbc.split('.').slice(3).join('.')||Number(saved.fbc.split('.')[2])>Number(fresh.fbc.split('.')[2])))result.fbc=saved.fbc;
 try{if(Object.keys(fresh).length)storage?.setItem(key,JSON.stringify({values:result,expires:now+90*86400000}));}catch{}
 return result;
}
export function browserMetaAttribution(search=location.search) {
 let storage,session;try{storage=localStorage}catch{}try{session=sessionStorage}catch{}
 const allowed=marketingAllowed(search);
 // Migrate the previous session-only cache, including browsers where durable
 // storage is blocked. Clear both stores on explicit withdrawal.
 if(!allowed){captureMetaAttribution('', '',session,Date.now(),false);return captureMetaAttribution('', '',storage,Date.now(),false)}
 let cookies='';try{cookies=document.cookie}catch{}
 try{if(storage&&!storage.getItem(META_CONTEXT_KEY)&&session?.getItem(META_CONTEXT_KEY))storage.setItem(META_CONTEXT_KEY,session.getItem(META_CONTEXT_KEY))}catch{storage=session}
 return captureMetaAttribution(search,cookies,storage||session);
}
export function marketingAllowed(search=location.search){return navigator.globalPrivacyControl!==true&&window.wlMarketingConsent!==false&&new URLSearchParams(search).get('metaOptOut')!=='1'}
