// Shared by the current site and frozen A/B designs. Never blocks navigation.
import {createClickBudget} from './steam-click-budget.js';
let clickStorage;try{clickStorage=sessionStorage}catch{}
const clickBudget=createClickBudget(clickStorage);
const endpoint='/.netlify/functions/steam-click';
const read=k=>{try{return localStorage.getItem(k)}catch{return null}};
const allowed=()=>read('wl_measurement')==='yes'&&navigator.globalPrivacyControl!==true&&new URLSearchParams(location.search).get('metaOptOut')!=='1'&&!new URLSearchParams(location.search).has('variant');
const token=s=>/^[a-zA-Z0-9_.-]{1,100}$/.test(s||'')?s:'';
function appUrl(href){try{const u=new URL(href,location.href);return u.hostname==='store.steampowered.com'&&/^\/(app|widget)\/\d+(\/|$)/.test(u.pathname)?u:null}catch{return null}}
function context(){
 const q=new URLSearchParams(location.search),keys=['utm_source','utm_medium','utm_campaign','utm_content','utm_term','campaign_id','adset_id','ad_id'];
 let old={};try{old=JSON.parse(sessionStorage.getItem('wl_steam_source')||'{}')}catch{}
 const incoming=Object.fromEntries(keys.map(k=>[k,token(q.get(k))]).filter(([,v])=>v));
 const previousFbc=old.fbc;
 const changed=(q.has('fbclid')&&!previousFbc?.endsWith('.'+q.get('fbclid')))||keys.some(k=>incoming[k]&&incoming[k]!==old[k]);
 if(changed)old={...incoming,...(old.fbp?{fbp:old.fbp}:{})};
 if(q.has('fbclid')&&/^[A-Za-z0-9_-]{1,4000}$/.test(q.get('fbclid')))old.fbc=previousFbc?.endsWith('.'+q.get('fbclid'))?previousFbc:`fb.1.${Date.now()}.${q.get('fbclid')}`;
 for(const [key,cookie]of [['fbp','_fbp'],['fbc','_fbc']]){let value;try{value=decodeURIComponent(document.cookie.split('; ').find(x=>x.startsWith(cookie+'='))?.slice(cookie.length+1)||'')}catch{}if(value&&/^fb\.\d+\.\d+\.[\w.-]+$/.test(value)&&!old[key])old[key]=value;}
 try{sessionStorage.setItem('wl_steam_source',JSON.stringify(old))}catch{}
 return old;
}
function decorate(a){const u=appUrl(a.href);if(!u)return null;const appId=u.pathname.split('/')[2],widget=token(a.dataset.steamWidget||a.id)||token(a.closest('[id]')?.id)||'steam-link';
 // UTM values describe a cohort, never a unique person or a Meta click ID.
 const c=allowed()?context():{};
 u.searchParams.set('utm_source',c.utm_source||'wonderlang');u.searchParams.set('utm_medium',c.utm_medium||'website');
 u.searchParams.set('utm_campaign',c.utm_campaign||'steam_'+appId);
 u.searchParams.set('utm_content',[c.adset_id||c.utm_content||'site',c.ad_id||widget].join('.').slice(0,200));
 u.searchParams.set('utm_term',widget);a.href=u.href;return {u,appId,widget,c};}
function scan(){document.querySelectorAll('a[href]').forEach(decorate);
 // Cross-origin iframe clicks cannot be observed. Provide a real adjacent link.
 document.querySelectorAll('iframe[src*="store.steampowered.com/widget/"]').forEach((frame,i)=>{if(frame.dataset.wlTracked)return;const u=appUrl(frame.src);if(!u)return;frame.dataset.wlTracked='1';const a=document.createElement('a');a.href='https://store.steampowered.com/app/'+u.pathname.split('/')[2]+'/';a.dataset.steamWidget='steam-widget-'+i;a.className='button outline';a.textContent=({fr:'Voir sur Steam',es:'Ver en Steam'})[document.documentElement.lang]||'View on Steam';frame.after(a);const d=decorate(a);for(const [k,v]of d.u.searchParams)if(k.startsWith('utm_'))u.searchParams.set(k,v);frame.src=u.href;});
}
function clicked(event){if(event.type==='auxclick'&&event.button!==1)return;const a=event.target.closest?.('a[href]');if(!a)return;const d=decorate(a);if(!d||!allowed()||!event.isTrusted)return;
 let visitorId=read('wl_visitor');if(!/^[0-9a-f-]{36}$/i.test(visitorId||'')){visitorId=crypto.randomUUID();try{localStorage.setItem('wl_visitor',visitorId)}catch{}}
 const data={id:crypto.randomUUID(),visitorId,appId:d.appId,widget:d.widget,page:location.pathname.slice(0,200),locale:document.documentElement.lang.slice(0,10),utm:Object.fromEntries(['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].map(k=>[k,d.u.searchParams.get(k)||''])),source:d.c,consent:true};
 const ticket=clickBudget.reserve(JSON.stringify([data.appId,data.widget,data.page,data.utm,data.source.fbc||'',data.source.fbp||'']));if(!ticket)return;
 fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),keepalive:true}).then(r=>{if(!r.ok)clickBudget.release(ticket)}).catch(()=>clickBudget.release(ticket));
}
document.addEventListener('click',clicked,true);document.addEventListener('auxclick',clicked,true);
document.addEventListener('pointerdown',e=>{const a=e.target.closest?.('a[href]');if(a)decorate(a)},true);
document.addEventListener('contextmenu',e=>{const a=e.target.closest?.('a[href]');if(a)decorate(a)},true);
document.addEventListener('click',e=>{if(e.target.closest?.('[data-consent="no"]')){clickBudget.clear();const visitorId=read('wl_visitor');if(visitorId)fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'withdraw',visitorId}),keepalive:true}).catch(()=>{});try{sessionStorage.removeItem('wl_steam_source')}catch{}}},true);
if(allowed())context();scan();
new MutationObserver(records=>{if(records.some(r=>r.addedNodes.length))scan()}).observe(document.body,{childList:true,subtree:true});
