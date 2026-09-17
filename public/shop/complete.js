(async () => {
  const sessionId = new URLSearchParams(location.search).get('session_id');
  if (!/^cs_live_[A-Za-z0-9]+$/.test(sessionId || '')) return location.replace('/account/');
  sessionStorage.setItem('wl-purchase-pending', sessionId);
  const finish=()=>location.replace('/account/');
  const timeout=setTimeout(finish,4500);
  try {
    const recovery=JSON.parse(sessionStorage.getItem('wl-purchase:'+sessionId)||'{}');
    if(recovery.locale)localStorage.setItem('wonderlang-account-language',recovery.locale);
    if(!recovery.claimSecret)return finish();
    const response=await fetch('/.netlify/functions/website-conversion',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,claimSecret:recovery.claimSecret}),signal:AbortSignal.timeout(2000)});
    if(!response.ok)return finish();
    const {conversion}=await response.json();
    if(!conversion||!Number.isFinite(conversion.value)||conversion.value<=0||conversion.transactionId!==sessionId)return finish();
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
