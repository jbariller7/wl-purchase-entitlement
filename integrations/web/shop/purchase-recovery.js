// Local recovery survives Stripe returning in another tab. The URL token is
// separately scoped to conversion verification; it cannot claim an order/key.
export function saveRecovery(sessionId, value, win=window, now=Date.now()) {
 const entry=JSON.stringify({...value,expires:now+3*86400000});
 for(const name of ['sessionStorage','localStorage'])try{win[name].setItem('wl-purchase:'+sessionId,entry)}catch{}
}
export function readRecovery(sessionId, win=window, now=Date.now()) {
 for(const name of ['sessionStorage','localStorage'])try{
  const entry=JSON.parse(win[name].getItem('wl-purchase:'+sessionId)||'null');
  if(entry&&(!entry.expires||entry.expires>now))return entry;
  if(entry)win[name].removeItem('wl-purchase:'+sessionId);
 }catch{}
 return {};
}
export function conversionCredential(recovery, hash='') {
 const token=new URLSearchParams(hash.replace(/^#/,'')).get('conversion_token')||recovery.conversionToken;
 if(/^[a-f0-9]{64}$/.test(token||''))return {conversionToken:token};
 if(/^[A-Za-z0-9_-]{43}$/.test(recovery.claimSecret||''))return {claimSecret:recovery.claimSecret};
 return null;
}
