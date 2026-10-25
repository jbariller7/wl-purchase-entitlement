import {marketingAllowed} from '../shop/checkout-attribution.js';
import {loadMetaPixel,restoreMetaCookies} from '../shop/purchase-tracking.js';
export const VIP_PIXEL='552284573796131';
let pageSent=false,pixelInitialized=false;
const inflight=new Set(),sent=new Map();
export async function vipFunnel(name,parameters={}){
 if(!['PageView','InitiateCheckout'].includes(name)||!marketingAllowed())return false;
 try{
  await loadMetaPixel(window,document);
  if(!marketingAllowed()||(name==='PageView'&&pageSent))return false;
  if(!pixelInitialized){window.fbq('init',VIP_PIXEL);pixelInitialized=true;}
  window.fbq('trackSingle',VIP_PIXEL,name,parameters);
  if(name==='PageView')pageSent=true;
  return true;
 }catch{return false;}
}
export async function vipPurchase(conversion){
 const c=conversion;
 if(!marketingAllowed()||!c||c.eventName!=='Purchase'||c.pixelId!==VIP_PIXEL||
  !/^beyond-vip:cs_live_[A-Za-z0-9]+$/.test(c.eventId)||c.value!==1||c.currency!=='USD'||
  !Number.isFinite(c.eventTime)||Math.abs(Date.now()/1000-c.eventTime)>86400||
  !/^WonderLang_Beyond_VIP_[a-z-]+$/.test(c.product)||
  (c.emailSha256&&!/^[a-f0-9]{64}$/.test(c.emailSha256)))return false;
 if(inflight.has(c.eventId)||Date.now()-(sent.get(c.eventId)??0)<10000)return false;
 inflight.add(c.eventId);
 try{
  // The return controller removes its private query before calling this function.
  if(/[?&](token|session_id)=/.test(location.search))return false;
  restoreMetaCookies(c,document);
  await loadMetaPixel(window,document);
  if(!marketingAllowed())return false;
  window.fbq('init',c.pixelId,c.emailSha256?{em:c.emailSha256}:{});
  window.fbq('trackSingle',c.pixelId,'Purchase',{
   value:1,currency:'USD',content_ids:[c.product],content_type:'product'
  },{eventID:c.eventId});
  sent.set(c.eventId,Date.now());
  return true; // Queued in the browser, not a delivery acknowledgement.
 }catch{return false;}finally{inflight.delete(c.eventId);}
}
