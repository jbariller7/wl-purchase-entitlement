import {browserMetaAttribution,addAttribution,marketingAllowed} from './checkout-attribution.js';
import {ensureShopMetaContext} from './shop-meta-context.js';

// Also available as /shop/landing-attribution.js for marketing pages that do
// not embed the shop. It sends no conversion and creates no invented IDs.
browserMetaAttribution();
// The old homepage waits for interaction outside the shop iframe. Start Meta
// on the marketing page too, so iframe-only buyers have a browser identifier.
if(!navigator.webdriver&&!/bot|crawler|spider/i.test(navigator.userAgent||''))void ensureShopMetaContext();
function decorateCheckoutLink(event){
 const link=event.target?.closest?.('a[href]');if(!link)return;
 let url;try{url=new URL(link.href,location.href)}catch{return}
 const checkout=['https://wonderlang.app','https://wl-purchase-entitlement.netlify.app'].includes(url.origin)&&url.pathname.startsWith('/shop/');
 const marketing=['https://wonderlang.net','https://www.wonderlang.net','https://lp.wonderlang.net'].includes(url.origin);
 if(!checkout&&!marketing)return;
 if(url.origin===location.origin&&url.pathname===location.pathname)return;
 for(const key of ['fbp','fbc','fbclid','metaOptOut'])url.searchParams.delete(key);
 if(marketingAllowed())addAttribution(url.searchParams,browserMetaAttribution());else url.searchParams.set('metaOptOut','1');
 link.href=url.href;
}
for(const name of ['pointerdown','click','contextmenu'])document.addEventListener(name,decorateCheckoutLink,true);
window.addEventListener('focus',()=>browserMetaAttribution());
