import {pages} from './pages-content.js';
import {renderPage,contactText} from './page-render.js';
const slug=document.body.dataset.page;
const query=new URLSearchParams(location.search);
let saved;try{saved=localStorage.getItem('wl_lang')}catch{}
let lang=[query.get('lang'),saved,navigator.language?.slice(0,2)].find(x=>pages[slug]?.[x])||'en';
let requestId=crypto.randomUUID(),sending=false,lastPayload=null;
function render(){
 document.documentElement.lang=lang;document.title=pages[slug][lang].title+' — WonderLang';
 document.querySelector('meta[name="description"]').content=pages[slug][lang].intro;
 document.body.innerHTML=renderPage(slug,lang);
 document.getElementById('page-language').addEventListener('change',event=>{
  if(sending)return;
  const form=document.getElementById('contact-form'),draft=form?Object.fromEntries(new FormData(form)):null;
  lang=event.target.value;try{localStorage.setItem('wl_lang',lang)}catch{}
  query.set('lang',lang);history.replaceState(null,'','?'+query+location.hash);render();
  if(draft)for(const [key,value]of Object.entries(draft)){const field=document.querySelector(`[name="${key}"]`);if(field)field.value=value}
 });
 document.getElementById('page-privacy')?.addEventListener('click',()=>{location.href='/testsite/?lang='+lang+'#privacy-settings'});
 document.getElementById('contact-form')?.addEventListener('submit',async event=>{
  event.preventDefault();if(sending)return;const form=event.currentTarget;if(!form.reportValidity())return;
  sending=true;const button=form.querySelector('button'),status=document.getElementById('contact-status'),select=document.getElementById('page-language');
  button.disabled=true;select.disabled=true;button.textContent=contactText[lang].sending;status.textContent='';
  try{
   const fields=Object.fromEntries(new FormData(form));
   const payload=JSON.stringify({...fields,locale:lang});if(lastPayload&&payload!==lastPayload)requestId=crypto.randomUUID();lastPayload=payload;
   const response=await fetch('/.netlify/functions/contact',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...fields,id:requestId,locale:lang})});
   if(!response.ok)throw new Error(response.status===429?'rate':'error');
   const data=await response.json();if(data.accepted!==true)throw new Error('error');
   status.textContent=contactText[lang].success+data.id;form.reset();requestId=crypto.randomUUID();
  }catch(error){status.textContent=contactText[lang][error.message==='rate'?'rate':'error']}
  finally{sending=false;button.disabled=false;select.disabled=false;button.textContent=contactText[lang].send}
 });
 document.dispatchEvent(new Event('wonderlang-page-rendered'));
}
render();
