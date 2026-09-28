// Bounded retries of read-only verification; this never creates a purchase or
// queues a second server conversion. Stripe's session ID stays the event ID.
export async function verifiedConversion(sessionId,claimSecret,{fetcher=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
 for(let attempt=0;attempt<3;attempt++){
  if(attempt)await wait(attempt*1500);
  try{
   const response=await fetcher('/.netlify/functions/website-conversion',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({sessionId,claimSecret}),signal:AbortSignal.timeout(15000)
   });
   if(!response.ok){if(response.status===429||response.status>=500)continue;return null;}
   const {conversion}=await response.json();
   if(conversion===null)continue; // Stripe may still be completing a redirect payment.
   if(!conversion||conversion.transactionId!==sessionId||!Number.isFinite(conversion.value)||conversion.value<=0)return null;
   return conversion;
  }catch{/* A slow cold start or temporary disconnect is safe to retry. */}
 }
 return null;
}

export function loadMetaPixel(win,doc,timeoutMs=15000){
 if(typeof win.fbq?.callMethod==='function')return Promise.resolve();
 if(win.__wlMetaLoading)return win.__wlMetaLoading;
 const promise=new Promise((resolve,reject)=>{
  if(!win.fbq){
   const fbq=function(){fbq.callMethod?fbq.callMethod.apply(fbq,arguments):fbq.queue.push(arguments)};
   fbq.queue=[];fbq.loaded=true;fbq.version='2.0';win.fbq=fbq;win._fbq=fbq;
  }
  const script=doc.createElement('script');script.async=true;script.src='https://connect.facebook.net/en_US/fbevents.js';
  const fail=()=>{clearTimeout(timer);script.remove();reject(new Error('Meta script unavailable'));};
  const timer=setTimeout(fail,timeoutMs);
  script.onerror=fail;
  script.onload=()=>{if(typeof win.fbq?.callMethod!=='function')return fail();clearTimeout(timer);resolve();};
  doc.head.append(script);
 });
 win.__wlMetaLoading=promise;
 return promise.finally(()=>{if(win.__wlMetaLoading===promise)delete win.__wlMetaLoading});
}

export async function reportMetaPurchase(conversion,{win=window,doc=document,nav=navigator,load=()=>loadMetaPixel(win,doc)}={}){
 const meta=conversion.meta,sessionId=conversion.transactionId;
 const allowed=()=>nav.globalPrivacyControl!==true&&win.wlMarketingConsent!==false;
 if(!allowed()||!/^cs_live_[A-Za-z0-9]+$/.test(sessionId)||!/^\d+$/.test(meta?.pixelId)||meta.eventId!==sessionId||meta.eventName!=='Purchase')return false;
 const key='wl-meta-purchase:'+sessionId;
 const sent=()=>{try{return win.localStorage.getItem(key)==='1'}catch{return false}};
 if(sent())return false;
 win.__wlMetaPurchases=win.__wlMetaPurchases||new Set();
 if(win.__wlMetaPurchases.has(sessionId))return false;
 win.__wlMetaPurchases.add(sessionId);
 try{
  await load();
  if(!allowed()||sent()){win.__wlMetaPurchases.delete(sessionId);return false;}
  win.fbq('init',meta.pixelId,meta.emailSha256?{em:meta.emailSha256}:{});
  win.fbq('trackSingle',meta.pixelId,'Purchase',{value:conversion.value,currency:conversion.currency,content_ids:[meta.product],content_type:'product'},{eventID:sessionId});
  // This records handoff to the loaded pixel, not an acknowledgement from Meta.
  // A script blocked/failed before loading must remain eligible for a retry.
  try{win.localStorage.setItem(key,'1')}catch{}
  return true;
 }catch{win.__wlMetaPurchases.delete(sessionId);return false;}
}
