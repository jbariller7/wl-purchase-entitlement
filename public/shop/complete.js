(async () => {
  const sessionId = new URLSearchParams(location.search).get('session_id');
  if (!/^cs_live_[A-Za-z0-9]+$/.test(sessionId || '')) return location.replace('/account/');
  sessionStorage.setItem('wl-purchase-pending', sessionId);
  let metaDelivery=Promise.resolve();
  const finish=()=>{Promise.race([metaDelivery,new Promise(resolve=>setTimeout(resolve,1500))]).finally(()=>location.replace('/account/'));};
  const timeout=setTimeout(finish,4500);
  try {
    const recovery=JSON.parse(sessionStorage.getItem('wl-purchase:'+sessionId)||'{}');
    if(recovery.locale)localStorage.setItem('wonderlang-account-language',recovery.locale);
    if(!recovery.claimSecret)return finish();
    const response=await fetch('/.netlify/functions/website-conversion',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,claimSecret:recovery.claimSecret}),signal:AbortSignal.timeout(2000)});
    if(!response.ok)return finish();
    const {conversion}=await response.json();
    if(!conversion||!Number.isFinite(conversion.value)||conversion.value<=0||conversion.transactionId!==sessionId)return finish();
    // Browser and durable server delivery share the verified Stripe session ID.
    // Respect an explicit tracking opt-out; never issue a consent grant here.
    const metaSentKey='wl-meta-purchase:'+sessionId;
    let metaAlreadyQueued=false;try{metaAlreadyQueued=localStorage.getItem(metaSentKey)==='1';}catch{}
    if(conversion.meta && !metaAlreadyQueued && navigator.globalPrivacyControl!==true && window.wlMarketingConsent!==false){
      const meta=conversion.meta;
      if(/^\d+$/.test(meta.pixelId)&&meta.eventId===sessionId&&meta.eventName==='Purchase'){
        metaDelivery=new Promise(resolve=>{
          const fbq=window.fbq||(window.fbq=function(){fbq.callMethod?fbq.callMethod.apply(fbq,arguments):fbq.queue.push(arguments);});
          if(!fbq.queue){fbq.queue=[];fbq.loaded=true;fbq.version='2.0';window._fbq=fbq;}
          fbq('init',meta.pixelId,meta.emailSha256?{em:meta.emailSha256}:{});
          fbq('trackSingle',meta.pixelId,'Purchase',{value:conversion.value,currency:conversion.currency,content_ids:[meta.product],content_type:'product'},{eventID:meta.eventId});
          try{localStorage.setItem(metaSentKey,'1');}catch{}
          const pixel=document.createElement('script');pixel.async=true;pixel.src='https://connect.facebook.net/en_US/fbevents.js';
          pixel.onload=()=>setTimeout(resolve,500);pixel.onerror=resolve;document.head.append(pixel);
          setTimeout(resolve,2000);
        });
      }
    }
    window.dataLayer=window.dataLayer||[];
    function gtag(){window.dataLayer.push(arguments);}
    // Cookieless by default; never grant consent on the customer's behalf.
    gtag('consent','default',{ad_storage:'denied',analytics_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
    gtag('js',new Date());
    const attribution=new URLSearchParams();for(const key of ['gclid','gbraid','wbraid']){const value=recovery.googleClick?.[key];if(typeof value==='string'&&value.length<=255)attribution.set(key,value);}
    gtag('config','AW-11250182984',{send_page_view:false,page_location:location.origin+'/shop/complete/'+(attribution.size?'?'+attribution:'')});
    gtag('event','conversion',{send_to:'AW-11250182984/ucsJCLS58aUcEMjWwPQp',value:conversion.value,currency:conversion.currency,transaction_id:conversion.transactionId,event_callback:()=>{clearTimeout(timeout);finish();},event_timeout:2000});
    const tag=document.createElement('script');tag.async=true;tag.src='https://www.googletagmanager.com/gtag/js?id=AW-11250182984';tag.onerror=finish;document.head.append(tag);
  } catch {clearTimeout(timeout);finish();}
})();
