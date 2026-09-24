import {emailCopy,emailLocale} from '../../../src/email/copy';
import {webCopy} from '../../../src/email/web-copy';
const sessionId=new URLSearchParams(location.search).get('session_id');
let recovery={};try{recovery=JSON.parse(sessionStorage.getItem('wl-purchase:'+sessionId)||'{}');}catch{}
const locale=emailLocale(recovery.locale||new URLSearchParams(location.search).get('lang'));
const copy=emailCopy[locale];
document.documentElement.lang=locale;document.documentElement.dir=locale==='ar'?'rtl':'ltr';
document.getElementById('title').textContent=copy[0];
document.getElementById('instructions').textContent=copy[4];
document.getElementById('account').href='/account/?lang='+encodeURIComponent(locale);
document.getElementById('support').textContent=webCopy[locale][0]+' ';
if(/^cs_live_[A-Za-z0-9]+$/.test(sessionId||'')){
 try{sessionStorage.setItem('wl-purchase-pending',sessionId);}catch{}
 if(recovery.claimSecret)load();
}
async function load(){
 try{
  const response=await fetch('/.netlify/functions/website-confirmation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,claimSecret:recovery.claimSecret}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)return;
  const result=await response.json();
  document.documentElement.lang=result.locale;document.documentElement.dir=result.locale==='ar'?'rtl':'ltr';
  document.getElementById('title').textContent=result.title;
  // Server-rendered, escaped order content; never take HTML from URL or storage.
  document.getElementById('content').innerHTML=result.contentHtml;
 }catch{ /* Keep the localized account recovery instructions available. */ }
}
