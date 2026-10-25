'use strict';
// Localization changes presentation only. Eligibility remains server-verified.
const config = JSON.parse(document.getElementById('beyond-language-config').textContent);
const query = new URLSearchParams(location.search);
// Retain private verification credentials only in this tab, never in pixel URLs.
const privacyDenied = query.get('metaOptOut') === '1';
try {
 if (query.has('session_id') && query.has('token')) sessionStorage.setItem('wl-vip-return', JSON.stringify({session_id:query.get('session_id'),token:query.get('token')}));
 else if (!query.has('session_id') && !query.has('token')) {
  const saved=JSON.parse(sessionStorage.getItem('wl-vip-return')||'null');
  if(saved){query.set('session_id',saved.session_id);query.set('token',saved.token);}
 }
} catch {}
const cleanQuery=new URLSearchParams();
if(query.has('lang'))cleanQuery.set('lang',query.get('lang'));
if(privacyDenied)cleanQuery.set('metaOptOut','1');
history.replaceState(null,'',location.pathname+(cleanQuery.size?'?'+cleanQuery:''));
let verifiedPurchase=null;
const reportPurchase=()=>{if(!privacyDenied && verifiedPurchase) void window.wlVipMeta?.purchase(verifiedPurchase);};
window.addEventListener('online',reportPurchase);
window.addEventListener('focus',reportPurchase);
const title = document.getElementById('reservation-title');
const status = document.getElementById('reservation-status');
const retry = document.getElementById('reservation-retry');
const next = document.getElementById('reservation-next');
const countdown = document.getElementById('reservation-countdown');
const stay = document.getElementById('reservation-stay');
const KICKSTARTER_URL = 'https://www.kickstarter.com/projects/jonathan-wonderlang/wonderlang-beyond-a-language-learning-rpg-for-intermediates';
let messages = config.messages, tiers = {}, language = 'en';
let redirectTimer = null, secondsRemaining = 8, paused = false;
let view = {kind: 'checking'}, requestSequence = 0;
const text = (key, values = {}) => (messages[key] || config.messages[key]).replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match));
function renderCountdown() {
  if (paused) { countdown.textContent = text('redirectPaused'); return; }
  const plural = new Intl.PluralRules(language).select(secondsRemaining);
  const key = 'countdown' + plural[0].toUpperCase() + plural.slice(1);
  countdown.textContent = text(messages[key] ? key : secondsRemaining === 1 ? 'countdownOne' : 'countdownMany', {seconds: secondsRemaining});
}
function render() {
  if (view.kind === 'checking') {
    title.textContent = text('checkingTitle'); status.textContent = text('checkingStatus');
  } else if (view.kind === 'paid') {
    title.textContent = text('verifiedTitle');
    status.textContent = text('verifiedStatus', {tier: tiers[view.tierName] || view.tierName});
    renderCountdown();
  } else if (view.kind === 'inactive') {
    title.textContent = text(view.state === 'pending' ? 'pendingTitle' : 'inactiveTitle');
    const stateKey = {pending:'statePending',paid:'statePaid',expired:'stateExpired',refunded:'stateRefunded',disputed:'stateDisputed'}[view.state] || 'stateUnknown';
    status.textContent = text('stateStatus', {state: text(stateKey)});
  } else {
    title.textContent = text('errorTitle');
    status.textContent = text(view.error) + ' ' + text('alreadyPaid');
  }
}
function stopRedirect() { clearTimeout(redirectTimer); redirectTimer = null; }
function startRedirect() {
  stopRedirect(); secondsRemaining = 8; paused = false; stay.hidden = false;
  function tick() {
    renderCountdown();
    redirectTimer = setTimeout(() => {
      secondsRemaining -= 1;
      if (secondsRemaining === 0) { location.replace(KICKSTARTER_URL); return; }
      tick();
    }, 1000);
  }
  tick();
}
async function check() {
  const request = ++requestSequence;
  stopRedirect(); paused = false; retry.hidden = true; next.hidden = true;
  view = {kind:'checking'}; render();
  try {
    const session = query.get('session_id'), token = query.get('token');
    if (!session || !token) { view = {kind:'error',error:'missingLink'}; retry.hidden = false; render(); return; }
    const response = await fetch('/.netlify/functions/beyond-vip?action=status&session_id=' + encodeURIComponent(session) + '&token=' + encodeURIComponent(token) + ((privacyDenied || window.wlVipMeta?.allowed() === false) ? '&metaOptOut=1' : ''), {cache:'no-store'});
    if (request !== requestSequence) return;
    if (!response.ok) {
      view = {kind:'error',error:({400:'badRequest',404:'notFound',429:'rateLimited',503:'unavailable'})[response.status] || 'checkFailed'};
      retry.hidden = false; render(); return;
    }
    const data = await response.json();
    if (request !== requestSequence) return;
    if (data.eligible === true && data.state === 'paid') {
      view = {kind:'paid',tierName: typeof data.tierName === 'string' ? data.tierName : ''};
      verifiedPurchase=data.conversion; reportPurchase();
      next.hidden = false; startRedirect();
    } else {
      view = {kind:'inactive',state:data.state}; retry.hidden = false;
    }
  } catch {
    if (request !== requestSequence) return;
    view = {kind:'error',error:'checkFailed'}; retry.hidden = false;
  }
  render();
}
document.addEventListener('beyond:language', event => {
  messages = event.detail.text; tiers = event.detail.tiers; language = event.detail.language;
  render(); // Changing language never rechecks payment or resets the countdown.
});
stay.addEventListener('click', () => { stopRedirect(); paused = true; stay.hidden = true; renderCountdown(); });
retry.addEventListener('click', check);
check();
