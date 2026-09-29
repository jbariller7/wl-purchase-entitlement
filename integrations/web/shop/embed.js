import {browserMetaAttribution,addAttribution,marketingAllowed} from './checkout-attribution.js';
import './landing-attribution.js';
(() => {
  const script = document.currentScript;
  if (!script) return;
  const scriptOrigin = new URL(script.src).origin;
  const origin = scriptOrigin === 'https://wl-purchase-entitlement.netlify.app' ? 'https://wonderlang.app' : scriptOrigin;
  const frame = document.createElement('iframe');
  const url = new URL('/shop/', origin);
  // Capture on the marketing site's origin before entering the cross-domain frame.
  addAttribution(url.searchParams,browserMetaAttribution());
  if(!marketingAllowed())url.searchParams.set('metaOptOut','1');
  const clicks=new URLSearchParams(location.search);
  for(const key of ['ttclid','gclid','gbraid','wbraid']){const value=clicks.get(key);if(value&&value.length<=255)url.searchParams.set(key,value);}
  const normalizeLanguage = value => ({jp:'ja',kr:'ko',ua:'uk',zh:'zh-CN',pt:'pt-PT'}[value] || value);
  const pageLanguage = () => {
    let saved='';try{saved=localStorage.getItem('wl_lang')||''}catch{}
    return normalizeLanguage(script.dataset.language || saved || document.getElementById('wl-lang-select')?.value || document.documentElement.lang || navigator.language);
  };
  url.searchParams.set('lang',pageLanguage());
  url.searchParams.set('embedded','1');
  url.searchParams.set('parentOrigin',location.origin);
  if(document.getElementById('wl-lang-select'))url.searchParams.set('parentLanguage','1');
  if (script.dataset.currency) url.searchParams.set('currency', script.dataset.currency);
  frame.src = url.href;
  frame.title = 'WonderLang';
  frame.style.cssText = 'width:100%;height:1800px;border:0;display:block';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  window.addEventListener('message', event => {
    if (event.origin !== origin || event.source !== frame.contentWindow || event.data?.type !== 'wonderlang-shop-height') return;
    const height = Number(event.data.height);
    if (Number.isFinite(height) && height >= 200 && height <= 12000) frame.style.height = Math.ceil(height) + 'px';
  });
  script.after(frame);
  const sendLanguage=()=>frame.contentWindow?.postMessage({type:'wonderlang-shop-context',lang:normalizeLanguage(script.dataset.language||document.getElementById('wl-lang-select')?.value||pageLanguage()),parentLanguage:Boolean(document.getElementById('wl-lang-select')),meta:browserMetaAttribution(),marketingAllowed:marketingAllowed()},origin);
  frame.addEventListener('load',sendLanguage);
  // Pixels/consent can finish after the iframe has loaded. Keep its checkout
  // links current without reloading the shop or changing the customer's choices.
  window.addEventListener('focus',sendLanguage);
  window.addEventListener('message',event=>{
    if(event.origin===origin&&event.source===frame.contentWindow&&event.data?.type==='wonderlang-shop-ready')sendLanguage();
  });
  let lastContext='';
  setInterval(()=>{if(document.hidden)return;const value=JSON.stringify([browserMetaAttribution(),window.wlMarketingConsent,navigator.globalPrivacyControl]);if(value!==lastContext){lastContext=value;sendLanguage()}},1000);
  document.addEventListener('change',event=>{if(event.target?.id==='wl-lang-select')sendLanguage()});
  new MutationObserver(sendLanguage).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
})();
