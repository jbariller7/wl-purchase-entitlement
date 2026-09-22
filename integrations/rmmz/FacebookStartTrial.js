/*:
* @target MZ
* @plugindesc (v3.2) Desktop-only Pixel events (FB, TT, Google, Reddit) + Title Screen Bonus Content Form.
* @author WonderLang
*
* @param pixelId
* @text Facebook Pixel ID
* @type string
* @desc Your numeric Facebook Pixel ID (e.g. 123456789012345).
* @default
*
* @param eventFullName
* @text FB Full Version Event Name
* @type string
* @desc Facebook event to fire when the full game is detected.
* @default Purchase
*
* @param eventDemoName
* @text FB Demo Version Event Name
* @type string
* @desc Facebook event to fire when the demo is detected.
* @default StartTrial
*
* @param tiktokPixelId
* @text TikTok Pixel ID
* @type string
* @desc Your TikTok Pixel ID.
* @default D2AUAUJC77U9U4KDNK2G
*
* @param tiktokEventFullName
* @text TT Full Version Event Name
* @type string
* @desc TikTok event to fire when the full game is detected.
* @default CompletePayment
*
* @param tiktokEventDemoName
* @text TT Demo Version Event Name
* @type string
* @desc TikTok event to fire when the demo is detected.
* @default StartTrial
*
* @param googleAwId
* @text Google AW- ID
* @type string
* @desc Your Google Ads AW- ID.
* @default AW-11250182984
*
* @param googleTrialLabel
* @text Google StartTrial Label
* @type string
* @desc The conversion label for StartTrial.
* @default jALoCP3z8aUcEMjWwPQp
*
* @param googlePurchaseLabel
* @text Google Purchase Label
* @type string
* @desc The conversion label for Purchase.
* @default ucsJCLS58aUcEMjWwPQp
*
* @param redditPixelId
* @text Reddit Pixel ID
* @type string
* @desc Your Reddit Pixel ID.
* @default a2_e0uvb7jcpzwi
*
* @param redditEventFullName
* @text Reddit Full Version Event
* @type string
* @desc Reddit event for full game.
* @default Purchase
*
* @param redditEventDemoName
* @text Reddit Demo Version Event
* @type string
* @desc Reddit event for demo (Fires as Custom Event if not a standard Reddit event).
* @default StartTrial
*
* @param skipIfSaveExists
* @text Skip If Save Exists
* @type boolean
* @desc If true, the boot event will NOT fire when at least one save file is detected.
* @default true
*
* @param alwaysFire
* @text Always Fire Boot Events
* @type boolean
* @desc If true, fires the chosen boot event on every launch (ignores first-time-only).
* @default false
*
* @param mailerLiteAction
* @text MailerLite Form Action URL
* @type string
* @desc The action URL from your MailerLite form code.
* @default https://assets.mailerlite.com/jsonp/1292227/forms/144956028970075999/subscribe
*/

(() => {
"use strict";

/* === Playtime check across savefiles === */
function _timeTextToHours(txt) {
  if (txt == null) return 0;
  if (typeof txt === "number" && isFinite(txt)) return txt / 3600;
  const nums = String(txt).match(/\d+/g) || [];
  let h = 0, m = 0, s = 0;
  if (nums.length >= 3) { h = +nums[0]; m = +nums[1]; s = +nums[2]; }
  else if (nums.length === 2) { m = +nums[0]; s = +nums[1]; }
  else if (nums.length === 1) { s = +nums[0]; }
  return h + m / 60 + s / 3600;
}
function _globalInfoSync() {
  const gi = DataManager && DataManager._globalInfo;
  return Array.isArray(gi) ? gi : [];
}
window.hasAnySaveOverHours = function(hours) {
  try {
    const info = _globalInfoSync();
    const max = Math.max(info.length - 1, 0);
    for (let id = 1; id <= max; id++) {
      const entry = info[id];
      if (!entry) continue;
      if (_timeTextToHours(entry.playtime) >= hours) return true;
    }
  } catch (e) { console.warn(e); }
  return false;
};
/* ======================================= */

const p = PluginManager.parameters('FacebookStartTrial');
const PIXEL_ID = String(p.pixelId || '').trim();
const EVENT_FULL_FB = String(p.eventFullName || 'Purchase').trim();
const EVENT_DEMO_FB = String(p.eventDemoName || 'StartTrial').trim();

const TT_PIXEL_ID = String(p.tiktokPixelId || '').trim();
const EVENT_FULL_TT = String(p.tiktokEventFullName || 'CompletePayment').trim();
const EVENT_DEMO_TT = String(p.tiktokEventDemoName || 'StartTrial').trim();

const GOOGLE_AW_ID = String(p.googleAwId || 'AW-11250182984').trim();
const GOOGLE_TRIAL_LABEL = String(p.googleTrialLabel || 'jALoCP3z8aUcEMjWwPQp').trim();
const GOOGLE_PURCHASE_LABEL = String(p.googlePurchaseLabel || 'ucsJCLS58aUcEMjWwPQp').trim();

const RDT_PIXEL_ID = String(p.redditPixelId || 'a2_e0uvb7jcpzwi').trim();
const EVENT_FULL_RDT = String(p.redditEventFullName || 'Purchase').trim();
const EVENT_DEMO_RDT = String(p.redditEventDemoName || 'StartTrial').trim();

const SKIP_IF_SAVES = String(p.skipIfSaveExists || 'true') === 'true';
const ALWAYS_FIRE = String(p.alwaysFire || 'false') === 'true';
const FLAG_KEY = 'fbtt_versionEventFired';

// This plugin is intentionally desktop-only. Check both RPG Maker's mobile
// detection and native/mobile runtime signals so iOS and Android deployments
// never load tracking scripts, initialize pixels, or send conversion events.
function isDesktopDeployment() {
try {
if (typeof Utils !== 'undefined' && Utils.isMobileDevice()) return false;

const nav = typeof navigator !== 'undefined' ? navigator : null;
const ua = String(nav?.userAgent || nav?.vendor || '');
const platform = String(nav?.platform || '');
if (/Android|iPhone|iPad|iPod/i.test(ua)) return false;
if (platform === 'MacIntel' && Number(nav?.maxTouchPoints || 0) > 1) return false;
if (nav?.userAgentData?.mobile === true) return false;

if (typeof window !== 'undefined') {
if (typeof window.AndroidManager !== 'undefined') return false;
if (typeof window.webkit?.messageHandlers !== 'undefined') return false;
}
} catch (_) {
// If detection itself fails, do not risk sending tracking from an unknown runtime.
return false;
}
return true;
}

let ML_ACTION = String(p.mailerLiteAction || '').trim();
if (!ML_ACTION) {
ML_ACTION = 'https://assets.mailerlite.com/jsonp/1292227/forms/144956028970075999/subscribe';
}

function fileExistsSync(url) {
try {
const xhr = new XMLHttpRequest();
xhr.open('HEAD', url, false);
xhr.send();
return xhr.status >= 200 && xhr.status < 300;
} catch (_) { return false; }
}

let _isDemoCache = null;
function isDemoVersion() {
if (_isDemoCache !== null) return _isDemoCache;
_isDemoCache = !fileExistsSync("data/Map010.json");
return _isDemoCache;
}

let menuTranslations = null;
function getUiLanguageUpper2() {
const code = String(ConfigManager?.uiLanguage || "EN").toUpperCase();
if (code === "ZH") {
const mode172 = Number($gameVariables?.value?.(172) || 0);
if (mode172 === 1 || mode172 === 2) return "ZH_hir";
if (mode172 === 3 || mode172 === 4) return "ZH_trad";
}
return code;
}
function tr(key) {
const L = getUiLanguageUpper2();
if (!menuTranslations) return key;
const candidates = [L, String(L).toLowerCase(), String(L).toUpperCase()];
for (const c of candidates) if (menuTranslations[c]?.[key] != null) return menuTranslations[c][key];
if (menuTranslations.en?.[key] != null) return menuTranslations.en[key];
return key;
}

function loadMenuTranslations() {
if (menuTranslations) return Promise.resolve();
return new Promise((resolve) => {
try {
const xhr = new XMLHttpRequest();
xhr.open("GET", `texts/menu.json`);
xhr.overrideMimeType("application/json");
xhr.onload = () => {
if (xhr.status < 400) {
const data = JSON.parse(xhr.responseText);
menuTranslations = data.translations || data;
}
resolve();
};
xhr.onerror = () => resolve();
xhr.send();
} catch (_) { resolve(); }
});
}

const tdb = (txt) => {
try { if (window.Ignis?.TextDatabase?.replaceText && typeof txt === "string") return Ignis.TextDatabase.replaceText(txt); }
catch (_) { }
return txt;
}

function injectFacebookPixel(id, advancedMatching = null) {
try {
if (!isDesktopDeployment() || !id) return;
if (!window.fbq) {
const fbq = function() {
fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments);
};
fbq.queue = [];
fbq.loaded = true;
fbq.version = '2.0';
window.fbq = fbq;
window._fbq = fbq;
const s = document.createElement('script');
s.async = true;
s.src = 'https://connect.facebook.net/en_US/fbevents.js';
document.head.appendChild(s);
}
if (advancedMatching) {
window.fbq('init', id, advancedMatching);
} else {
window.fbq('init', id);
}
} catch (e) { }
}

function injectTikTokPixel(id, advancedMatching = null) {
try {
if (!isDesktopDeployment() || !id) return;
if (!window.ttq) {
(function(w, d, t) {
w.TiktokAnalyticsObject = t;
var ttq = w[t] = w[t] || [];
ttq.methods = ["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"];
ttq.setAndDefer = function(obj, method) {
obj[method] = function() {
obj.push([method].concat(Array.prototype.slice.call(arguments, 0)));
};
};
for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
ttq.instance = function(name) {
var inst = ttq._i[name] || [];
for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(inst, ttq.methods[i]);
return inst;
};
ttq.load = function(e, n) {
var r = "https://analytics.tiktok.com/i18n/pixel/events.js";
ttq._i = ttq._i || {}; ttq._i[e] = []; ttq._i[e]._u = r;
ttq._t = ttq._t || {}; ttq._t[e] = +new Date();
ttq._o = ttq._o || {}; ttq._o[e] = n || {};
var s = d.createElement("script");
s.type = "text/javascript"; s.async = true; s.src = r + "?sdkid=" + e + "&lib=" + t;
if (d.head) d.head.appendChild(s);
else d.documentElement.appendChild(s);
};
})(window, document, 'ttq');
}
window.__ttqLoadedIds = window.__ttqLoadedIds || {};
if (!window.__ttqLoadedIds[id]) {
window.ttq.load(id);
window.ttq.page();
window.__ttqLoadedIds[id] = true;
}
if (advancedMatching) {
window.ttq.identify(advancedMatching);
}
} catch (e) { }
}

function injectGooglePixel(id) {
try {
if (!isDesktopDeployment() || !id || window.gtag) return;
const s = document.createElement('script');
s.async = true;
s.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
document.head.appendChild(s);
window.dataLayer = window.dataLayer || [];
window.gtag = function(){ dataLayer.push(arguments); };
window.gtag('js', new Date());
window.gtag('config', id);
} catch (e) {}
}

function injectRedditPixel(id) {
try {
if (!isDesktopDeployment() || !id) return;
if (!window.rdt) {
var p = window.rdt = function(){
p.sendEvent ? p.sendEvent.apply(p,arguments) : p.callQueue.push(arguments)
};
p.callQueue = [];
var t = document.createElement("script");
t.src = "https://www.redditstatic.com/ads/pixel.js"; t.async = true;
var s = document.getElementsByTagName("script")[0];
s.parentNode.insertBefore(t,s);
}
window.rdt('init', id);
window.rdt('track', 'PageVisit');
} catch (e) {}
}

function hasExistingSave() {
const info = DataManager._globalInfo || DataManager.loadGlobalInfo();
return Array.isArray(info) && info.some(entry => entry);
}

const _Scene_Boot_start = Scene_Boot.prototype.start;
Scene_Boot.prototype.start = function() {
_Scene_Boot_start.call(this);
try {
if (!isDesktopDeployment()) return;
if (typeof localStorage === 'undefined') return;
if (!ALWAYS_FIRE) {
if (localStorage.getItem(FLAG_KEY)) return;
if (SKIP_IF_SAVES && hasExistingSave()) return;
}

const isDemo = isDemoVersion();
// A launch is not a payment. Keep the owner's PDF-claim Purchase proxy below,
// but never assign fabricated revenue to installed/restored desktop copies.
if (!isDemo) return;
const fbEvent = isDemo ? EVENT_DEMO_FB : EVENT_FULL_FB;
const ttEvent = isDemo ? EVENT_DEMO_TT : EVENT_FULL_TT;
const googleLabel = isDemo ? GOOGLE_TRIAL_LABEL : GOOGLE_PURCHASE_LABEL;
const rdtEvent = isDemo ? EVENT_DEMO_RDT : EVENT_FULL_RDT;

injectFacebookPixel(PIXEL_ID);
injectTikTokPixel(TT_PIXEL_ID);
injectGooglePixel(GOOGLE_AW_ID);
injectRedditPixel(RDT_PIXEL_ID);

setTimeout(() => {
if (!isDesktopDeployment()) return;
const eventVal = 0;
const eventCur = 'USD';

if (fbEvent && typeof fbq !== 'undefined') {
try { fbq('track', fbEvent, { value: eventVal, currency: eventCur }); } catch (e) {}
}
if (ttEvent && typeof ttq !== 'undefined') {
try { ttq.track(ttEvent, { content_name: 'WonderLang Game', value: eventVal, currency: eventCur, quantity: 1 }); } catch (e) {}
}
if (typeof gtag !== 'undefined' && GOOGLE_AW_ID && googleLabel) {
try { gtag('event', 'conversion', { 'send_to': `${GOOGLE_AW_ID}/${googleLabel}`, 'value': eventVal, 'currency': eventCur }); } catch (e) {}
}

if (rdtEvent && typeof rdt !== 'undefined') {
try {
const rdtStandard = ['PageVisit', 'ViewContent', 'Search', 'AddToCart', 'AddToWishlist', 'Purchase', 'Lead', 'SignUp'];
if (rdtStandard.includes(rdtEvent)) {
rdt('track', rdtEvent, { value: eventVal, currency: eventCur });
} else {
// Safely pass custom events to Reddit without breaking tracking
rdt('track', 'Custom', { customEventName: rdtEvent, value: eventVal, currency: eventCur });
}
} catch (e) {}
}
}, 1000);

if (!ALWAYS_FIRE) localStorage.setItem(FLAG_KEY, '1');
} catch (e) {}
};

const BONUS_REPORT_KEY = 'wl_steam_bonus_conversion_v1';
let bonusReportInFlight = false;
let nextBonusReportAt = 0;
async function flushSteamBonusConversion() {
if (bonusReportInFlight || Date.now() < nextBonusReportAt || !isDesktopDeployment()) return;
let pending;
try { pending = JSON.parse(localStorage.getItem(BONUS_REPORT_KEY) || 'null'); } catch (_) { return; }
if (!pending || pending.sent || !/^[a-f0-9]{64}$/.test(pending.emailSha256)) return;
bonusReportInFlight = true;
try {
const payload = { emailSha256: pending.emailSha256 };
for (const [key, cookie] of [['fbp', '_fbp'], ['fbc', '_fbc']]) {
const entry = document.cookie.split('; ').find(x => x.startsWith(cookie + '='));
if (entry) { const value = decodeURIComponent(entry.slice(cookie.length + 1)); if (/^fb\.\d+\.\d+\.[\w.-]+$/.test(value) && value.length <= 255) payload[key] = value; }
}
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10000);
let response;
try { response = await fetch('https://wonderlang.app/.netlify/functions/steam-bonus-conversion', {
method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload), signal: controller.signal
}); } finally { clearTimeout(timeout); }
if (!response.ok) throw new Error('Reporting deferred');
const result = await response.json();
if (result.eventId !== 'steam-bonus-v1:' + pending.emailSha256) throw new Error('Invalid reporting response');
if (result.trackBrowser === true) {
injectFacebookPixel(PIXEL_ID, {em: pending.emailSha256});
if (typeof window.fbq === 'function') window.fbq('track', 'Purchase', {
currency: 'USD', value: 0, content_ids: ['WonderLang_Bonus'], content_type: 'product', conversion_kind: 'steam_pdf_proxy'
}, {eventID: result.eventId});
}
localStorage.setItem(BONUS_REPORT_KEY, JSON.stringify({...pending, sent: true}));
} catch (_) { nextBonusReportAt = Date.now() + 15 * 60 * 1000; }
finally { bonusReportInFlight = false; }
}
async function queueSteamBonusConversion(email) {
const bytes = new TextEncoder().encode(String(email).trim().toLowerCase());
const digest = await crypto.subtle.digest('SHA-256', bytes);
const emailSha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
let previous; try { previous = JSON.parse(localStorage.getItem(BONUS_REPORT_KEY) || 'null'); } catch (_) {}
if (previous?.emailSha256 !== emailSha256) {
localStorage.setItem(BONUS_REPORT_KEY, JSON.stringify({emailSha256, sent: false}));
nextBonusReportAt = 0;
}
await flushSteamBonusConversion();
}
window.addEventListener('online', () => { flushSteamBonusConversion().catch(() => {}); });
setTimeout(() => { flushSteamBonusConversion().catch(() => {}); }, 5000);
setInterval(() => { flushSteamBonusConversion().catch(() => {}); }, 60000);

const BonusHUD = {
_btnRoot: null,
_modalRoot: null,
_isInitialized: false,
_isInitializing: false,

async init() {
if (!isDesktopDeployment() || isDemoVersion()) return;
if (this._isInitialized || this._isInitializing) return;
this._isInitializing = true;

await loadMenuTranslations();

injectFacebookPixel(PIXEL_ID);
injectTikTokPixel(TT_PIXEL_ID);
injectGooglePixel(GOOGLE_AW_ID);
injectRedditPixel(RDT_PIXEL_ID);

if (!document.getElementById("wlBonusHUDStyles")) {
const style = document.createElement("style");
style.id = "wlBonusHUDStyles";
style.innerHTML = `
#wlBonusBtnWrap {
position: fixed; z-index: 2147483646; display: none;
bottom: 4.5vh; left: 16.8vw; 
pointer-events: none;
}
#wlBonusBtnWrap * { font-family: NotoSans, Symbola, sans-serif !important; box-sizing: border-box; user-select: none; }
.wl-bonus-btn { 
display: flex; align-items: center; gap: 0.8vw; 
background: linear-gradient(135deg, #8E2DE2 0%, #4A00E0 100%); 
border: 0.3vh solid #b678ff; border-radius: 1.5vh; 
padding: 1.2vh 2vw; cursor: pointer; pointer-events: auto; 
box-shadow: 0 1vh 2vh rgba(0,0,0,0.5), inset 0 0 1vh rgba(255,255,255,0.2); 
transition: transform 0.12s ease, filter 0.12s ease, box-shadow 0.12s ease; 
}
.wl-bonus-btn:hover { transform: scale(1.05); filter: brightness(1.15); box-shadow: 0 1.2vh 2.5vh rgba(0,0,0,0.6); }
.wl-bonus-btn:active { transform: scale(0.98); }
.wl-bonus-text { color: #ffffff; font-weight: 900; font-size: 2.2vh; text-shadow: 0 0.2vh 0.4vh rgba(0,0,0,0.8); line-height: 1; white-space: nowrap; -webkit-text-stroke: 0 !important; }
.wl-bonus-icon { font-size: 2.8vh; line-height: 1; filter: drop-shadow(0 0.2vh 0.4vh rgba(0,0,0,0.5)); -webkit-text-stroke: 0 !important;}

#wlBonusModalOverlay {
position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
background: rgba(0,0,0,0.85); z-index: 2147483647; display: none;
align-items: center; justify-content: center; opacity: 0;
transition: opacity 0.25s ease;
}
#wlBonusModalOverlay * { font-family: NotoSans, Symbola, sans-serif !important; box-sizing: border-box; }
.wl-bm-box {
position: relative; width: 90%; max-width: 500px;
background: linear-gradient(to bottom right, rgba(0,0,0,0.94), rgba(92,21,129,0.94));
border: 0.3vh solid #F1C40F; border-radius: 2vh;
padding: 4vh 3vw; color: #fff; text-align: center;
box-shadow: 0 2vh 4vh rgba(0,0,0,0.8);
}
.wl-bm-close {
position: absolute; top: 1.5vh; right: 1.5vh;
background: rgba(255,255,255,0.1); border: none; color: #fff;
width: 4vh; height: 4vh; border-radius: 50%; font-weight: bold;
font-size: 2vh; cursor: pointer; transition: background 0.2s;
-webkit-text-stroke: 0 !important;
}
.wl-bm-close:hover { background: rgba(255,255,255,0.3); }
.wl-bm-title { font-size: 3vh; color: #F1C40F; margin: 0 0 1vh 0; font-weight: 900; -webkit-text-stroke: 0 !important; }
.wl-bm-desc { font-size: 1.8vh; margin: 0 0 2vh 0; color: rgba(255,255,255,0.9); line-height: 1.4; -webkit-text-stroke: 0 !important; }
.wl-bm-list { text-align: left; background: rgba(0,0,0,0.4); padding: 2vh; border-radius: 1vh; margin-bottom: 3vh; list-style: none; }
.wl-bm-list li { margin-bottom: 1vh; font-size: 1.7vh; -webkit-text-stroke: 0 !important;}
.wl-bm-list li:last-child { margin-bottom: 0; }

.wl-bm-form { display: flex; flex-direction: column; gap: 1.5vh; }
.wl-bm-input {
width: 100%; padding: 1.5vh; border-radius: 1vh; border: 0.2vh solid #fff;
background: rgba(255,255,255,0.9); font-size: 1.8vh; color: #000;
}
.wl-bm-submit {
width: 100%; padding: 1.5vh; border-radius: 1vh; border: none;
background: linear-gradient(135deg, #F1C40F 0%, #ED8936 100%);
color: #fff; font-weight: 900; font-size: 2vh; cursor: pointer;
box-shadow: 0 0.5vh 1vh rgba(0,0,0,0.3); transition: transform 0.1s, filter 0.1s;
-webkit-text-stroke: 0 !important;
}
.wl-bm-submit:hover { transform: translateY(-2px); filter: brightness(1.1); }
.wl-bm-submit:active { transform: translateY(0); }
.wl-bm-submit:disabled { filter: grayscale(1); cursor: not-allowed; opacity: 0.7; transform: none; }
.wl-bm-disclaimer { font-size: 1.4vh; color: rgba(255,255,255,0.6); margin: 0; margin-top: 0.5vh; line-height: 1.3; -webkit-text-stroke: 0 !important; }
`;
document.head.appendChild(style);
}

const btnWrap = document.createElement("div");
btnWrap.id = "wlBonusBtnWrap";
btnWrap.innerHTML = `
<div class="wl-bonus-btn" id="wlBonusBoxBtn">
<div class="wl-bonus-icon">🎁</div>
<div class="wl-bonus-text" data-k="Get free additional content">${tdb(tr("Get free additional content"))}</div>
</div>
`;
document.body.appendChild(btnWrap);
this._btnRoot = btnWrap;

const modalWrap = document.createElement("div");
modalWrap.id = "wlBonusModalOverlay";
modalWrap.innerHTML = `
<div class="wl-bm-box">
<button class="wl-bm-close" id="wlBmCloseBtn">✕</button>

<div id="wlBmContentArea">
<h2 class="wl-bm-title" data-k="Unlock Bonus Game Content!">${tdb(tr("Unlock Bonus Game Content!"))}</h2>
<p class="wl-bm-desc" data-k="Receive bonus companion PDF content for your adventure:">${tdb(tr("Receive bonus companion PDF content for your adventure:"))}</p>
<ul class="wl-bm-list">
<li data-k="📖 Printable flashcards with vocabulary">${tdb(tr("📖 Printable flashcards with vocabulary"))}</li>
<li data-k="📙 A phrasebook with key sentences">${tdb(tr("📙 A phrasebook with key sentences"))}</li>
<li data-k="✏️ An exercise book for extra practice">${tdb(tr("✏️ An exercise book for extra practice"))}</li>
</ul>

<form id="wlBonusForm" action="${ML_ACTION}" method="POST" target="ml-hidden-iframe" class="wl-bm-form">
<input type="email" class="wl-bm-input" name="fields[email]" id="wlBonusEmail" data-k="Your Email Address" placeholder="${tdb(tr("Your Email Address"))}" required>
<input type="hidden" name="ml-submit" value="1">
<input type="hidden" name="anticsrf" value="true">
<button type="submit" class="wl-bm-submit" id="wlBonusSubmitBtn" data-k="Send my bonus content!">${tdb(tr("Send my bonus content!"))}</button>
<p class="wl-bm-disclaimer" data-k="You will receive a link to download your free PDF content. You will not receive any other email from us and we will never share your email address.">${tdb(tr("You will receive a link to download your free PDF content. You will not receive any other email from us and we will never share your email address."))}</p>
</form>
</div>

<div id="wlBmSuccessArea" style="display:none;">
<h2 class="wl-bm-title" style="font-size: 4vh; margin-top: 2vh;">🎉 <span data-k="Thank you!">${tdb(tr("Thank you!"))}</span></h2>
<p class="wl-bm-desc" style="font-size: 2vh; margin-bottom: 2vh;" data-k="Check your inbox! If you can't find our email, check your spam box too!">${tdb(tr("Check your inbox! If you can't find our email, check your spam box too!"))}</p>
<button class="wl-bm-submit" id="wlBmSuccessCloseBtn" data-k="Close">${tdb(tr("Close"))}</button>
</div>
</div>
<iframe name="ml-hidden-iframe" id="mlHiddenIframe" style="position: absolute; width: 1px; height: 1px; top: -9999px; left: -9999px; visibility: hidden; border: none;"></iframe>
`;
document.body.appendChild(modalWrap);
this._modalRoot = modalWrap;

this.applyLanguage();

const stopAll = (el) => {
["pointerdown","mousedown","touchstart","pointerup","mouseup","touchend","pointermove","mousemove","touchmove","contextmenu"].forEach(type=>{
el.addEventListener(type, (e) => { e.stopPropagation(); }, { capture:true, passive:false });
});
};

const btnEl = btnWrap.querySelector("#wlBonusBoxBtn");
stopAll(btnEl);

btnEl.addEventListener("click", (e) => {
e.stopPropagation(); e.preventDefault();
SoundManager.playOk?.();

const isVeteran = localStorage.getItem('wl_bonus_claimed') === 'true' || (window.hasAnySaveOverHours && window.hasAnySaveOverHours(8));

if (isVeteran) {
    const kickstarterUrl = 'https://www.kickstarter.com/projects/jonathan-wonderlang/wonderlang-beyond-a-language-learning-rpg-for-intermediates';
    
    // Check if running in NW.js (Standalone PC/Mac/Linux build)
    if (typeof nw !== 'undefined' && nw.Shell) {
        nw.Shell.openExternal(kickstarterUrl);
    } else {
        // Fallback for Web/Browser versions
        window.open(kickstarterUrl, '_blank');
    }
} else {
    this.openModal();
}
}, { capture: true, passive: false });

const handleClose = (e) => {
e.preventDefault(); e.stopPropagation();
SoundManager.playCancel?.();
this.closeModal();
};

const topCloseBtn = modalWrap.querySelector("#wlBmCloseBtn");
topCloseBtn.addEventListener("click", handleClose, { capture: true, passive: false });

const successCloseBtn = modalWrap.querySelector("#wlBmSuccessCloseBtn");
successCloseBtn.addEventListener("click", handleClose, { capture: true, passive: false });

const formEl = modalWrap.querySelector("#wlBonusForm");
const submitBtn = modalWrap.querySelector("#wlBonusSubmitBtn");
const iframeEl = modalWrap.querySelector("#mlHiddenIframe");

stopAll(formEl); 

formEl.addEventListener("submit", (e) => {
const email = modalWrap.querySelector("#wlBonusEmail").value;
submitBtn.textContent = "Processing...";
submitBtn.disabled = true;

// Flag that the user claimed the bonus
localStorage.setItem('wl_bonus_claimed', 'true');

// Persist the Meta retry before unrelated pixel/IP lookups or closing the game.
queueSteamBonusConversion(email).catch(() => {});
(async () => {
let ipAddress = '';
try {
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 3000);
let res = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
let data = await res.json();
ipAddress = data.ip;
clearTimeout(timeoutId);
} catch(err) {}

if (typeof ttq !== 'undefined') {
try {
window.ttq.identify({ email: email, external_id: ipAddress });
window.ttq.track('CompletePayment', { content_id: 'WonderLang_Bonus', content_type: 'product', content_name: 'Bonus PDF Content', quantity: 1, price: 0.00, value: 0.00, currency: 'USD' });
} catch(e) {}
}
if (typeof gtag !== 'undefined') {
try { gtag('event', 'generate_lead', { value: 0.00, currency: 'USD' }); } catch(e) {}
}
if (typeof rdt !== 'undefined') {
try { rdt('track', 'Lead', { value: 0.00, currency: 'USD' }); } catch(e) {}
}
})();

setTimeout(() => {
modalWrap.querySelector("#wlBmContentArea").style.display = "none";
modalWrap.querySelector("#wlBmSuccessArea").style.display = "block";
}, 1200);

}, { capture: true });

this._isInitializing = false;
this._isInitialized = true;
},

applyLanguage() {
if (this._btnRoot) {
this._btnRoot.querySelectorAll("[data-k]").forEach(el => {
el.textContent = tdb(tr(el.getAttribute("data-k")));
});
}
if (this._modalRoot) {
this._modalRoot.querySelectorAll("[data-k]").forEach(el => {
const key = el.getAttribute("data-k");
if (el.tagName === "INPUT" && el.hasAttribute("placeholder")) {
el.placeholder = tdb(tr(key));
} else {
el.textContent = tdb(tr(key));
}
});
}
},

openModal() {
this.applyLanguage();

try {
const takelUrl = ML_ACTION.replace(/\/subscribe\/?$/, '/takel');
fetch(takelUrl, { mode: 'no-cors' }).catch(()=>{});
} catch(e) {}

this._modalRoot.style.display = "flex";
this._modalRoot.querySelector("#wlBmContentArea").style.display = "block";
this._modalRoot.querySelector("#wlBmSuccessArea").style.display = "none";
const submitBtn = this._modalRoot.querySelector("#wlBonusSubmitBtn");
submitBtn.textContent = tdb(tr("Send my bonus content!"));
submitBtn.disabled = false;
this._modalRoot.querySelector("#wlBonusEmail").value = "";

requestAnimationFrame(() => { this._modalRoot.style.opacity = "1"; });
},

closeModal() {
this._modalRoot.style.opacity = "0";
setTimeout(() => {
this._modalRoot.style.display = "none";
}, 250);
},

updateVisibility() {
if (!isDesktopDeployment() || isDemoVersion()) {
if (this._btnRoot) this._btnRoot.style.display = "none";
return;
}

if (!this._isInitialized) {
if (!this._isInitializing) this.init();
return;
}

if (!this._btnRoot) return;

const scn = SceneManager._scene;
const isTitle = scn instanceof Scene_Title;

let shouldHide = !isTitle;

if (SceneManager.isSceneChanging() || (scn && scn._fadeDuration > 0)) {
shouldHide = true;
}

if (shouldHide) {
this._btnRoot.style.display = "none";
} else {
this._btnRoot.style.display = "block";

// Dynamically swap text/icon if they meet the conditions
const textEl = this._btnRoot.querySelector('.wl-bonus-text');
const iconEl = this._btnRoot.querySelector('.wl-bonus-icon');
if (textEl && iconEl) {
    const isVeteran = localStorage.getItem('wl_bonus_claimed') === 'true' || (window.hasAnySaveOverHours && window.hasAnySaveOverHours(8));
    if (isVeteran) {
        textEl.setAttribute('data-k', 'Discover the Sequel!');
        textEl.textContent = tdb(tr('Discover the Sequel!'));
        iconEl.textContent = '🚀';
    } else {
        textEl.setAttribute('data-k', 'Get free additional content');
        textEl.textContent = tdb(tr('Get free additional content'));
        iconEl.textContent = '🎁';
    }
}
}
}
};

const _Scene_Base_update = Scene_Base.prototype.update;
Scene_Base.prototype.update = function() {
_Scene_Base_update.call(this);
if (BonusHUD && BonusHUD.updateVisibility) {
BonusHUD.updateVisibility();
}
};

})();
