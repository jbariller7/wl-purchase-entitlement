import {loadMetaPixel,restoreMetaCookies} from './purchase-tracking.js';
import {browserMetaAttribution,marketingAllowed} from './checkout-attribution.js';

// Direct campaign links land on wonderlang.app without the marketing site's
// Pixel. Initialize the same public dataset here so Meta can issue its real
// browser cookie. Embedded shops instead receive their parent site's context.
export async function ensureShopMetaContext({waitMs=1500}={}){
 const initial=browserMetaAttribution();
 if(!marketingAllowed()||window.parent!==window)return initial;
 restoreMetaCookies(initial,document);
 try{
  // Checkout can proceed after 1.5s, but do not abort the Pixel download at
  // that point: real mobile connections regularly take longer.
  const initialize=loadMetaPixel(window,document).then(()=>{
  if(!marketingAllowed())return browserMetaAttribution();
  if(!window.__wlShopMetaInitialized){
   window.fbq('init','552284573796131');
   window.fbq('trackSingle','552284573796131','PageView');
   window.__wlShopMetaInitialized=true;
  }
  });
  await Promise.race([initialize,new Promise(resolve=>setTimeout(resolve,waitMs))]);
  initialize.catch(()=>{});
 }catch{/* A blocker must never prevent a real purchase. */}
 return browserMetaAttribution();
}
