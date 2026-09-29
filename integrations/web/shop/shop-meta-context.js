import {loadMetaPixel} from './purchase-tracking.js';
import {browserMetaAttribution,marketingAllowed} from './checkout-attribution.js';

// Direct campaign links land on wonderlang.app without the marketing site's
// Pixel. Initialize the same public dataset here so Meta can issue its real
// browser cookie. Embedded shops instead receive their parent site's context.
export async function ensureShopMetaContext(){
 const initial=browserMetaAttribution();
 if(!marketingAllowed()||window.parent!==window)return initial;
 try{
  await loadMetaPixel(window,document,1500);
  if(!marketingAllowed())return browserMetaAttribution();
  if(!window.__wlShopMetaInitialized){
   window.fbq('init','552284573796131');
   window.fbq('trackSingle','552284573796131','PageView');
   window.__wlShopMetaInitialized=true;
  }
 }catch{/* A blocker must never prevent a real purchase. */}
 return browserMetaAttribution();
}
