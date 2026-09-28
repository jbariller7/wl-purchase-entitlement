import {metaAttribution as parseMetaAttribution} from './attribution.js';
export {addAttribution} from './attribution.js';
export function metaAttribution(search, cookies = '', now = Date.now()) {
 return parseMetaAttribution(search,cookies.split(';').map(x=>x.trim()).join('; '),now);
}

// Preserve only real, already available identifiers through reloads and Stripe
// cancellation. Never invent a Facebook click or browser ID.
export function captureMetaAttribution(search, cookies, storage, now=Date.now(), allowed=true) {
 const key='wl-meta-context-v1';
 if(!allowed){try{storage?.removeItem(key)}catch{}return {};}
 let saved={};
 try {const entry=JSON.parse(storage?.getItem(key)||'null');
  if(entry&&entry.expires>now)saved=metaAttribution(new URLSearchParams(entry.values).toString());
 }catch{}
 const fresh=metaAttribution(search,cookies,now);
 const result={...saved,...fresh};
 // A late cookie write must not replace a more recent genuine ad click.
 if(saved.fbc&&fresh.fbc&&(saved.fbc.split('.').slice(3).join('.')===fresh.fbc.split('.').slice(3).join('.')||Number(saved.fbc.split('.')[2])>Number(fresh.fbc.split('.')[2])))result.fbc=saved.fbc;
 try{if(Object.keys(fresh).length)storage?.setItem(key,JSON.stringify({values:result,expires:now+86400000}));}catch{}
 return result;
}
export function browserMetaAttribution(search=location.search) {
 let storage;try{storage=sessionStorage}catch{}
 return captureMetaAttribution(search,document.cookie,storage,Date.now(),navigator.globalPrivacyControl!==true&&window.wlMarketingConsent!==false&&new URLSearchParams(search).get('metaOptOut')!=='1');
}
