import {verifiedConversion,reportMetaPurchase,loadMetaPixel} from './purchase-tracking.js';
import {readRecovery,saveRecovery,conversionCredential} from './purchase-recovery.js';

(async()=>{
 const sessionId=new URLSearchParams(location.search).get('session_id');
 if(!/^cs_live_[A-Za-z0-9]+$/.test(sessionId||''))return;
 const recovery=readRecovery(sessionId),credential=conversionCredential(recovery,location.hash);
 if(!credential)return;
 saveRecovery(sessionId,{...recovery,...credential});
 // Remove the narrowly scoped receipt before loading third-party scripts.
 if(location.hash)history.replaceState(null,'',location.pathname+location.search);
 try{sessionStorage.setItem('wl-purchase-pending',sessionId)}catch{}
 if(recovery.marketingAllowed===false)window.wlMarketingConsent=false;
 try{if(recovery.locale)localStorage.setItem('wonderlang-account-language',recovery.locale)}catch{}
 let conversion,busy=false,lastStatus;
 const until=Date.now()+5*60000;
 const sendMeta=async()=>{
  if(busy||Date.now()>until)return;
  busy=true;
  try{
   conversion=conversion||await verifiedConversion(sessionId,credential);
   if(conversion?.meta){
    const sent=await reportMetaPurchase(conversion);
    const pixelStatus=sent?'handed_off':'unavailable';
    if(pixelStatus!==lastStatus&&(sent||!lastStatus)){
     lastStatus=pixelStatus;
     fetch('/.netlify/functions/website-conversion',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,...credential,pixelStatus}),keepalive:true}).catch(()=>{});
    }
   }
  }finally{busy=false;}
 };
 // Verification and pixel loading overlap. Retry after a lost connection or
 // tab switch, even if fbq accepted an earlier call without a delivery ACK.
 if(recovery.marketingAllowed===true&&navigator.globalPrivacyControl!==true&&window.wlMarketingConsent!==false)loadMetaPixel(window,document).catch(()=>{});
 window.addEventListener('online',sendMeta);
 window.addEventListener('focus',sendMeta);
 for(const delay of [12000,30000,60000])setTimeout(sendMeta,delay);
 await sendMeta();
 if(!conversion)return;
 window.dataLayer=window.dataLayer||[];
 function gtag(){window.dataLayer.push(arguments)}
 gtag('consent','default',{ad_storage:'denied',analytics_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
 gtag('js',new Date());
 const attribution=new URLSearchParams();for(const key of ['gclid','gbraid','wbraid']){const value=recovery.googleClick?.[key];if(typeof value==='string'&&value.length<=255)attribution.set(key,value);}
 gtag('config','AW-11250182984',{send_page_view:false,page_location:location.origin+'/shop/complete/'+(attribution.size?'?'+attribution:'')});
 gtag('event','conversion',{send_to:'AW-11250182984/ucsJCLS58aUcEMjWwPQp',value:conversion.value,currency:conversion.currency,transaction_id:conversion.transactionId,event_timeout:2000});
 const tag=document.createElement('script');tag.async=true;tag.src='https://www.googletagmanager.com/gtag/js?id=AW-11250182984';document.head.append(tag);
})();
