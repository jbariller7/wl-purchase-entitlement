import {browserMetaAttribution,marketingAllowed,addAttribution} from '../shop/checkout-attribution.js';
import {vipFunnel} from './tracking.js';
export function decorateVipLinks(){
 const allowed=marketingAllowed();
 if(!allowed&&window.fbq)window.fbq('consent','revoke');
 const context=browserMetaAttribution();
 for(const a of document.querySelectorAll('a[href*="/.netlify/functions/beyond-vip?"]')){
  const url=new URL(a.href,location.href);if(url.origin!==location.origin)continue;
  for(const key of ['fbp','fbc','fbclid','metaOptOut'])url.searchParams.delete(key);
  if(allowed)addAttribution(url.searchParams,context);else url.searchParams.set('metaOptOut','1');
  a.href=url.href;
 }
}
decorateVipLinks();
document.addEventListener('click',decorateVipLinks,true);
document.addEventListener('auxclick',decorateVipLinks,true);
window.addEventListener('focus',decorateVipLinks);
window.addEventListener('storage',decorateVipLinks);
vipFunnel('PageView').then(decorateVipLinks);
document.addEventListener('click',event=>{
 const a=event.target.closest?.('a[href*="/.netlify/functions/beyond-vip?"]');
 if(!a||event.defaultPrevented)return;
 const url=new URL(a.href,location.href),tier=url.searchParams.get('tier');
 if(url.origin!==location.origin||url.searchParams.get('action')==='status'||!tier)return;
 void vipFunnel('InitiateCheckout',{value:1,currency:'USD',num_items:1,
  content_ids:['WonderLang_Beyond_VIP_'+tier],content_type:'product'});
});
