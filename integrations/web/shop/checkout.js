import ui from '../../../catalog/website-shop-ui.json';
const q=new URLSearchParams(location.search),locale=Object.hasOwn(ui,q.get('lang'))?q.get('lang'):'en',t=ui[locale];
document.documentElement.lang=locale;document.documentElement.dir=locale==='ar'?'rtl':'ltr';document.getElementById('heading').textContent=t[5];
try{
 const selection={offer:q.get('offer'),locale,currency:q.get('currency')||'USD'};
 for(const key of ['delivery','learningLanguage','mobilePlatform'])if(q.has(key))selection[key]=q.get(key);
 const storageKey='wl-checkout-attempt:'+JSON.stringify(selection);
 let attempt=JSON.parse(sessionStorage.getItem(storageKey)||'null');
 if(!attempt){attempt={requestId:crypto.randomUUID(),claimSecret:btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')};sessionStorage.setItem(storageKey,JSON.stringify(attempt))}
 const response=await fetch('/.netlify/functions/website-checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...selection,...attempt})});
 if(!response.ok){if(response.status===409)sessionStorage.removeItem(storageKey);throw new Error('Checkout unavailable');}
 const result=await response.json();
 if(!/^cs_[A-Za-z0-9_]+$/.test(result.sessionId||''))throw new Error('Invalid checkout reference');
 sessionStorage.setItem('wl-purchase:'+result.sessionId,JSON.stringify({claimSecret:attempt.claimSecret,locale}));
 if(result.completed===true){location.replace('/shop/complete/?session_id='+encodeURIComponent(result.sessionId));}
 else{const url=new URL(result.url);if(url.origin!=='https://checkout.stripe.com')throw new Error('Invalid checkout destination');location.replace(url.href);}
}catch{document.getElementById('heading').textContent=t[0];document.getElementById('status').textContent=t[4];}
