import {ui,slugs,labels} from './pages-content.js';
// Shared navigation is outside the frozen A/B page content. It is applied to
// every design, without changing assignments, experiment tokens or previews.
function renderDirectory(){
 const lang=ui[document.documentElement.lang]?document.documentElement.lang:'en',u=ui[lang];
 for(const n of document.querySelectorAll('.page-directory,.page-footer-links'))n.remove();
 const nav=document.createElement('nav');nav.className='page-directory';nav.setAttribute('aria-label',u.explore);
 const footer=document.createElement('nav');footer.className='page-footer-links';footer.setAttribute('aria-label',u.explore);
 slugs.forEach((slug,i)=>{const a=document.createElement('a');a.textContent=labels[lang][i];a.href='/testsite/'+slug+'/?lang='+lang;
  if(document.body.dataset.page===slug)a.setAttribute('aria-current','page');
  footer.append(a.cloneNode(true));if(i<5)nav.append(a);
 });
 document.querySelector('.site-header')?.after(nav);document.querySelector('footer')?.append(footer);
 if(location.hash==='#privacy-settings')document.getElementById('privacy-dialog')?.showModal();
}
new MutationObserver(renderDirectory).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
document.addEventListener('wonderlang-page-rendered',renderDirectory);renderDirectory();
// Carry real campaign context through supporting pages, including previews.
// Never forward identifiers to email, social or other third-party links.
document.addEventListener('click',event=>{
 const a=event.target.closest('a[href]');if(!a)return;
 const target=new URL(a.href,location.href),query=new URLSearchParams(location.search);
 if(target.origin!==location.origin||!/^\/(testsite|shop)\//.test(target.pathname))return;
 for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','fbc','fbp','gclid','ttclid','metaOptOut','variant'])if(query.has(key)&&!target.searchParams.has(key))target.searchParams.set(key,query.get(key));
 let rejected=false;try{rejected=localStorage.getItem('wl_measurement')==='no'}catch{}
 if(rejected||navigator.globalPrivacyControl===true){for(const key of ['fbclid','fbc','fbp','gclid','ttclid'])target.searchParams.delete(key);target.searchParams.set('metaOptOut','1')}
 a.href=target.href;
},true);
