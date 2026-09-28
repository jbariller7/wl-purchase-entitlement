import {verifiedConversion,reportMetaPurchase} from './purchase-tracking.js';

(async()=>{
 const sessionId=new URLSearchParams(location.search).get('session_id');
 if(!/^cs_live_[A-Za-z0-9]+$/.test(sessionId||''))return;
 let recovery;
 try{
  sessionStorage.setItem('wl-purchase-pending',sessionId);
  recovery=JSON.parse(sessionStorage.getItem('wl-purchase:'+sessionId)||'{}');
 }catch{return;}
 if(!recovery.claimSecret)return;
 try{if(recovery.locale)localStorage.setItem('wonderlang-account-language',recovery.locale)}catch{}
 const conversion=await verifiedConversion(sessionId,recovery.claimSecret);
 if(!conversion)return;
 // Retry a temporarily unavailable pixel with the same server event ID.
 const sendMeta=()=>reportMetaPurchase(conversion);
 sendMeta().then(sent=>{if(!sent){
  window.addEventListener('online',sendMeta,{once:true});
  window.addEventListener('focus',sendMeta,{once:true});
  setTimeout(sendMeta,5000);
 }});
 window.dataLayer=window.dataLayer||[];
 function gtag(){window.dataLayer.push(arguments)}
 gtag('consent','default',{ad_storage:'denied',analytics_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
 gtag('js',new Date());
 const attribution=new URLSearchParams();for(const key of ['gclid','gbraid','wbraid']){const value=recovery.googleClick?.[key];if(typeof value==='string'&&value.length<=255)attribution.set(key,value);}
 gtag('config','AW-11250182984',{send_page_view:false,page_location:location.origin+'/shop/complete/'+(attribution.size?'?'+attribution:'')});
 gtag('event','conversion',{send_to:'AW-11250182984/ucsJCLS58aUcEMjWwPQp',value:conversion.value,currency:conversion.currency,transaction_id:conversion.transactionId,event_timeout:2000});
 const tag=document.createElement('script');tag.async=true;tag.src='https://www.googletagmanager.com/gtag/js?id=AW-11250182984';document.head.append(tag);
})();
