import {browserMetaAttribution,addAttribution,marketingAllowed} from './checkout-attribution.js';

// Also available as /shop/landing-attribution.js for marketing pages that do
// not embed the shop. It sends no conversion and creates no invented IDs.
browserMetaAttribution();
function decorateCheckoutLink(event){
 const link=event.target?.closest?.('a[href]');if(!link)return;
 let url;try{url=new URL(link.href,location.href)}catch{return}
 if(!['https://wonderlang.app','https://wl-purchase-entitlement.netlify.app'].includes(url.origin)||!url.pathname.startsWith('/shop/'))return;
 for(const key of ['fbp','fbc','fbclid','metaOptOut'])url.searchParams.delete(key);
 if(marketingAllowed())addAttribution(url.searchParams,browserMetaAttribution());else url.searchParams.set('metaOptOut','1');
 link.href=url.href;
}
for(const name of ['pointerdown','click','contextmenu'])document.addEventListener(name,decorateCheckoutLink,true);
window.addEventListener('focus',()=>browserMetaAttribution());
