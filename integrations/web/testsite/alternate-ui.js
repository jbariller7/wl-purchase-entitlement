import '../steam-attribution.js';
import {measurementCopy} from './measurement-copy.js';

const lang = document.documentElement.lang;
const funding = document.body.dataset.redesign === 'fund';
const query = new URLSearchParams(location.search);
const copy = {
 en: {
  normal: 'Desktop editions for {language}: One Language, Polyglot or Premium Lifetime.',
  all: 'Desktop editions for {language}: Polyglot or Premium Lifetime. Choose an all-language edition.',
  scenes: ['Meet a shopkeeper and follow the conversation in French.', 'Put the words in order to build your reply.', 'Recall vocabulary to take your turn in battle.'],
  android: 'Try on Android', gameplay: 'Watch gameplay'
 },
 fr: {
  normal: 'Langue choisie : {language}. Sur ordinateur, choisissez l’édition Une langue, Polyglotte ou Premium à vie.',
  all: 'Langue choisie : {language}. Sur ordinateur, cette langue est comprise dans les éditions Polyglotte et Premium à vie.',
  scenes: ['Faites la connaissance d’une commerçante et suivez la conversation en français.', 'Remettez les mots dans l’ordre pour composer votre réponse.', 'Retrouvez les mots appris pour jouer votre tour au combat.'],
  android: 'Essayer sur Android', gameplay: 'Voir le jeu en action'
 },
 es: {
  normal: 'Idioma elegido: {language}. En ordenador puedes elegir la edición de un idioma, la Políglota o el pase Premium de por vida.',
  all: 'Idioma elegido: {language}. En ordenador se incluye en la edición Políglota y en el pase Premium de por vida.',
  scenes: ['Conoce a una comerciante y sigue la conversación en francés.', 'Ordena las palabras para construir tu respuesta.', 'Recuerda el vocabulario aprendido para jugar tu turno en el combate.'],
  android: 'Probar en Android', gameplay: 'Ver cómo se juega'
 }
}[lang];

// Carry the language and preview/traffic context only between our own pages.
// Never put visitor IDs, enrollment tokens or campaign identifiers on PayPal.
const permitted = ['variant','utm_source','utm_medium','utm_campaign','utm_content','utm_term','metaOptOut'];
let measurement = false;
try { measurement = localStorage.getItem('wl_measurement') === 'yes'; } catch {}
if (measurement && navigator.globalPrivacyControl !== true && query.get('metaOptOut') !== '1') {
 permitted.push('fbclid','gclid','ttclid','gbraid','wbraid','campaign_id','adset_id','ad_id');
}
function localUrl(href, locale) {
 const url = new URL(href, location.href);
 for (const key of permitted) if (query.has(key)) url.searchParams.set(key,query.get(key));
 url.searchParams.set('lang',locale);
 return url;
}
for (const link of document.querySelectorAll('[data-experiment-link]')) link.href = localUrl(link.href,lang);
if (funding) {
 document.querySelector('#wl-lang-select').addEventListener('change', e => {
  const locale=e.target.value;
  try { localStorage.setItem('wl_lang',locale); } catch {}
  location.assign(localUrl('fund-'+locale+'.html',locale));
 });
} else {
 document.querySelector('[data-disclosure]').textContent=measurementCopy[lang]+' ';
 const buttons=[...document.querySelectorAll('.view')];
 const sceneImages=['dialogue','sentences','combat'];
 buttons.forEach((button,index)=>button.addEventListener('click',()=>{
  const img=document.querySelector('#scene');
  img.src='../assets/'+sceneImages[index]+'.webp';
  img.alt=copy.scenes[index];
  document.querySelector('#caption').textContent=copy.scenes[index];
  buttons.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index)));
 }));
 document.querySelector('#language').addEventListener('change',e=>{
  const option=e.target.selectedOptions[0];
  const template=option.dataset.allLanguages==='true'?copy.all:copy.normal;
  document.querySelector('#result').textContent=template.replace('{language}',option.textContent);
 });
 const demo=document.querySelector('#demo');
 if (/Android/i.test(navigator.userAgent)) {
  demo.href='https://play.google.com/store/apps/details?id=com.wonderlang.app';
  demo.textContent=copy.android;demo.dataset.event='android_click';demo.classList.remove('steam-link');
 } else if (/iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)) {
  demo.href='#gameplay';demo.textContent=copy.gameplay;delete demo.dataset.event;demo.classList.remove('steam-link');
 }
 document.querySelector('#settings').addEventListener('click',()=>{
  const section=document.querySelector('#consent');
  section.hidden=false;section.scrollIntoView({block:'center'});
  section.querySelector('button').focus({preventScroll:true});
 });
 document.querySelector('a[href="#newsletter"]').addEventListener('click',()=>{
  document.querySelector('#newsletter').open=true;
 });
 if(location.hash==='#newsletter') document.querySelector('#newsletter').open=true;
 if(location.hash==='#privacy-settings') document.querySelector('#settings').click();
}
