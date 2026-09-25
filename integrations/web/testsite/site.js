import content from './content.json';
import funding from './funding.json';
import {variants,variantContent} from './variants.js';
import {metaAttribution,addAttribution} from '../shop/attribution.js';
const q=new URLSearchParams(location.search), $=id=>document.getElementById(id);
const storage={get(k){try{return localStorage.getItem(k)}catch{return null}},set(k,v){try{localStorage.setItem(k,v)}catch{}},remove(k){try{localStorage.removeItem(k)}catch{}}};
let lang=[q.get('lang'),storage.get('wl_lang'),navigator.language?.slice(0,2)].find(x=>content[x])||'en';
const originalSections=[...$('main').children];
const preview=['A','B'].includes(q.get('variant'));
const design=HOMEPAGE_DESIGN,assetRoot='/testsite/versions/'+design+'/assets/';
let defaultPage={design:HOMEPAGE_FALLBACK,variant:'A'};
let variant=preview?q.get('variant'):'A', enrollment=null, consent=storage.get('wl_measurement'), revision=0;
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n};
function cards(id,items){$(id).replaceChildren(...items.map(([title,copy],i)=>{const n=el('article');if(id==='features')n.append(el('span',String(i+1).padStart(2,'0'),'feature-number'));n.append(el('h3',title),el('p',copy));return n}))}
function render(){
 const spec=variants[variant],t=variantContent(content[lang],spec.content[lang]);document.documentElement.lang=lang;$('wl-lang-select').value=lang;
 document.querySelectorAll('[data-t]').forEach(n=>{const value=n.dataset.t.split('.').reduce((v,k)=>v?.[k],t);if(typeof value==='string')n.textContent=value});
 document.title='WonderLang — '+t[spec.heroKey].replace('\n',' ');document.querySelector('meta[name=description]').content=t.intro;
 $('hero-title').textContent=t[spec.heroKey];document.body.dataset.variant=variant;document.body.classList.toggle('variant-b',spec.reverseHero);
 for(const section of originalSections)$('main').append(section);
 for(const id of spec.sectionOrder){const section=$(id);if(section?.parentElement===$('main'))$('main').append(section)}
 [['hero-main',spec.primary==='buy'],['hero-secondary',spec.primary!=='buy']].forEach(([id,buy])=>{const n=$(id);n.textContent=t[buy?'buy':'play'];n.href=buy?'#pricing':'#demo';n.dataset.event=buy?'shop_click':'demo_click'});
 $('stats').replaceChildren(...[0,2,4].map(i=>{const n=el('div');n.append(el('strong',t.stats[i]),el('span',t.stats[i+1]));return n}));
 cards('features',t.features);cards('benefits',t.benefits);cards('funding-tiers',t.fundTiers);
 ['sentences','vocabulary'].forEach((name,i)=>{const n=el('figure'),img=el('img'),caption=el('figcaption');img.src=assetRoot+'gameplay-'+name+'.gif';img.alt=t.gifCopy[i];img.loading='lazy';img.width=i?480:400;img.height=i?270:225;caption.append(el('h3',t.gifTitles[i]),el('p',t.gifCopy[i]));n.append(img,caption);$(i?'gameplay-writing':'gameplay-motion').replaceChildren(n)});
 const usd=n=>new Intl.NumberFormat(lang,{style:'currency',currency:'USD',currencyDisplay:'code',maximumFractionDigits:0}).format(n);
 $('funding-grid').replaceChildren(...funding.pools.map((pool,i)=>{const card=el('article',null,'funding-card'),bar=el('progress');bar.max=funding.goal;bar.value=pool.amount;bar.setAttribute('aria-label',t.fundNames[i]);card.append(el('h3',t.fundNames[i]),el('span',t.fundStatuses[pool.status],'fund-status status-'+pool.status),bar,el('p',t.fundTotal.replace('{amount}',usd(pool.amount)).replace('{goal}',usd(funding.goal))));return card}));
 $('gallery').replaceChildren(...['dialogue','sentences','combat'].map((name,i)=>{const n=el('figure'),img=el('img');img.src=assetRoot+name+'.webp';img.alt=t.galleryAlt[i];img.loading='lazy';n.append(img);return n}));
 const codes=['FR','ES','DE','IT','EN','BR','KO','JA','ZH','AR','RU'];
 $('language-grid').replaceChildren(...t.languageNames.map((name,i)=>{const n=el('article',null,'language-card'),copy=el('div');copy.append(el('strong',name),el('small',t.languageNotes[i]));n.append(el('span',codes[i],'glyph'),copy);return n}));
 $('faq-list').replaceChildren(...t.faq.map(([question,answer])=>{const n=el('details');n.append(el('summary',question),el('p',answer));return n}));
 $('preview-notice').hidden=!preview;$('preview-notice').textContent=t.preview;
 if(frame){frame.title=t.shopLoading;frame.contentWindow?.postMessage({type:'wonderlang-shop-context',lang,parentLanguage:true},location.origin)}
 updateShop();
}
let frame=null,frameContext='';
function updateShop(){
 const url=new URL('/shop/',location.origin);url.searchParams.set('lang',lang);
 if(consent==='yes'){addAttribution(url.searchParams,metaAttribution(location.search,document.cookie));for(const key of ['ttclid','gclid','gbraid','wbraid']){const value=q.get(key);if(value&&value.length<=255)url.searchParams.set(key,value)}}
 if(enrollment)url.searchParams.set('experimentToken',enrollment.token);
 $('shop-fallback').href=url.href;
 const context=(enrollment?.token||'')+':'+consent;
 if(!frame||context!==frameContext){url.searchParams.set('embedded','1');url.searchParams.set('parentOrigin',location.origin);url.searchParams.set('parentLanguage','1');
 const next=el('iframe');next.title=content[lang].shopLoading;next.src=url.href;next.loading='lazy';next.style.cssText='width:100%;height:1650px;border:0;display:block';next.referrerPolicy='strict-origin-when-cross-origin';$('shop-host').replaceChildren(next);frame=next;frameContext=context;}
 document.querySelectorAll('.steam-link').forEach(n=>{const u=new URL(n.href);for(const key of ['utm_source','utm_medium','utm_campaign','utm_content'])u.searchParams.delete(key);if(enrollment){u.searchParams.set('utm_source','wonderlang');u.searchParams.set('utm_medium','website');u.searchParams.set('utm_campaign',enrollment.experimentId);u.searchParams.set('utm_content',enrollment.variant)}n.href=u.href});
}
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==frame?.contentWindow||event.data?.type!=='wonderlang-shop-height')return;const h=Number(event.data.height);if(h>=200&&h<=12000)frame.style.height=Math.ceil(h)+'px'});
async function api(data){const r=await fetch('/.netlify/functions/website-experiment',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),keepalive:true});if(!r.ok)throw Error('Measurement unavailable');return r.json()}
async function measure(name){if(!enrollment||consent!=='yes'||preview)return;try{await api({action:'event',token:enrollment.token,event:name})}catch{}}
function displayPage(page){
 if(page.design!==design){const target=new URL('/testsite/versions/'+page.design+'/',location.origin);target.search=location.search;target.hash=location.hash;location.replace(target.href);return false;}
 variant=page.variant;render();return true;
}
async function loadDefault(){try{const r=await fetch('/.netlify/functions/website-experiment',{cache:'no-store'});if(r.ok){const data=await r.json();if(/^page-[a-f0-9]{20}$/.test(data.defaultPage?.design)&&['A','B'].includes(data.defaultPage.variant))defaultPage=data.defaultPage;}}catch{}}
async function enroll(){const current=++revision;if(preview)return;if(consent!=='yes'){displayPage(defaultPage);return;}
 let visitorId=storage.get('wl_visitor');if(!/^[0-9a-f-]{36}$/i.test(visitorId||'')){visitorId=crypto.randomUUID();storage.set('wl_visitor',visitorId)}
 const medium=(q.get('utm_medium')||'').toLowerCase();const source=q.has('fbclid')||q.has('gclid')||q.has('ttclid')||['cpc','ppc','paid','paid_social'].includes(medium)?'paid':medium==='email'?'email':medium==='social'?'social':medium?'other':'direct';
 try{const data=await api({action:'enroll',visitorId,locale:lang,device:matchMedia('(max-width:760px)').matches?'mobile':'desktop',source});
 if(current!==revision||consent!=='yes')return;enrollment=data.enrollment||null;if(displayPage(enrollment||defaultPage)&&enrollment&&document.visibilityState==='visible')measure('exposure');}catch{if(current===revision)displayPage(defaultPage)}
}
async function choose(value){const old=enrollment;consent=value;storage.set('wl_measurement',value);$('consent').hidden=true;$('privacy-dialog').close();revision++;
 await loadDefault();
 if(value==='yes'){await enroll()}else{enrollment=null;storage.remove('wl_visitor');if(old)try{await api({action:'withdraw',token:old.token})}catch{}displayPage(defaultPage)}
}
$('wl-lang-select').addEventListener('change',e=>{lang=e.target.value;storage.set('wl_lang',lang);q.set('lang',lang);history.replaceState(null,'','?'+q+location.hash);render()});
document.querySelector('.menu-toggle').addEventListener('click',e=>{const open=e.currentTarget.getAttribute('aria-expanded')!=='true';e.currentTarget.setAttribute('aria-expanded',String(open));$('site-nav').classList.toggle('open',open)});
document.addEventListener('click',e=>{const a=e.target.closest('[data-event]');if(a)measure(a.dataset.event);if(e.target.closest('#site-nav a')){$('site-nav').classList.remove('open');document.querySelector('.menu-toggle').setAttribute('aria-expanded','false')}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')measure('exposure')});
document.querySelectorAll('[data-consent]').forEach(n=>n.addEventListener('click',()=>choose(n.dataset.consent)));
$('privacy-open').addEventListener('click',()=>$('privacy-dialog').showModal());$('privacy-close').addEventListener('click',()=>$('privacy-dialog').close());
// Keep the provider's original form ID, action and callback contract. Only a confirmed
// MailerLite response may display success; ordinary clicks never simulate a signup.
window.ml_webform_success_22154858=()=>{
 document.querySelector('#mlb2-22154858 .row-form').style.display='none';
 const success=document.querySelector('#mlb2-22154858 .row-success');success.style.display='block';success.focus();
};
fetch('https://assets.mailerlite.com/jsonp/1292227/forms/144956028970075999/takel').catch(()=>{});
if(preview){render()}else{loadDefault().then(enroll)}
$('consent').hidden=preview||Boolean(consent);
