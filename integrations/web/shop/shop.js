import countdownUnits from '../../../catalog/website-sale-countdown-units.json';
import {remainingSaleTime} from './sale-countdown.js';
import locales from '../../../catalog/website-checkout-locales.json';
import prices from '../../../catalog/website-prices.json';
import ui from '../../../catalog/website-shop-ui.json';
import mobile from '../../../catalog/website-mobile-locales.json';
import discountText from '../../../catalog/website-discount-locales.json';
import {metaAttribution,addAttribution} from './attribution.js';
import {REGIONAL_PRICES,stripeMinorAmount,currencyFractionDigits} from '../../../src/domain/regional-pricing.ts';
const native={en:'English',fr:'Français',de:'Deutsch',es:'Español','es-MX':'Español (Latinoamérica)','pt-BR':'Português (Brasil)','pt-PT':'Português (Portugal)',it:'Italiano',nl:'Nederlands',sv:'Svenska',pl:'Polski',uk:'Українська',ru:'Русский',id:'Bahasa Indonesia',ko:'한국어',ja:'日本語','zh-CN':'简体中文','zh-TW':'繁體中文',ar:'العربية',hy:'Հայերեն'};
const query=new URLSearchParams(location.search);
const metaContext=metaAttribution(location.search,document.cookie);
const browserLocale=navigator.language;
let lang=Object.hasOwn(locales,query.get('lang'))?query.get('lang'):Object.hasOwn(locales,browserLocale)?browserLocale:Object.hasOwn(locales,browserLocale.split('-')[0])?browserLocale.split('-')[0]:'en';
let currency=Object.hasOwn(prices,query.get('currency'))?query.get('currency'):'USD';
let manualCurrency=query.has('currency');
const embedded=query.get('embedded')==='1';
const gameEmbedded=embedded&&query.get('gameEmbed')==='1'&&parent!==window;
document.documentElement.classList.toggle('embedded',embedded);
const languageSelect=document.getElementById('language'),currencySelect=document.getElementById('currency');
for(const [value,label]of Object.entries(native))languageSelect.add(new Option(label,value));
for(const value of Object.keys(prices))currencySelect.add(new Option(value,value));
languageSelect.value=lang;currencySelect.value=currency;
languageSelect.closest('label').hidden=embedded&&query.get('parentLanguage')==='1';
const rememberedOptions={};
const publicSales=!query.has('campaign');
let publicCampaigns={};
let campaign=null,campaignLoading=query.has('campaign')||publicSales,campaignError=false;
let category='desktop';
const saleBanners=document.createElement('section');saleBanners.className='sale-banners';document.querySelector('main').prepend(saleBanners);
function updateCountdowns(){
 for(const timer of saleBanners.querySelectorAll('[data-sale-end]')){
  const time=remainingSaleTime(timer.dataset.saleEnd);
  if(!time)continue;
  const units=countdownUnits[lang]||countdownUnits.en;
  const numbers=new Intl.NumberFormat(lang,{minimumIntegerDigits:2,useGrouping:false});
  const values=[time.days,time.hours,time.minutes,time.seconds];
  if(!timer.childElementCount)for(let i=0;i<4;i++){
   const cell=document.createElement('span');cell.className='countdown-cell';
   const number=document.createElement('span');number.className='countdown-number';
   const label=document.createElement('span');label.className='countdown-unit';cell.append(number,label);timer.append(cell);
  }
  [...timer.children].forEach((cell,i)=>{const value=numbers.format(values[i]);if(cell.firstChild.textContent!==value)cell.firstChild.textContent=value;cell.lastChild.textContent=units[i];});
 }
}
function renderSaleBanners(){
 saleBanners.replaceChildren();
 const unique=new Set();
 for(const sale of campaign?[campaign]:Object.values(publicCampaigns)){
  const key=JSON.stringify([sale.name,sale.expiresAt]);if(unique.has(key))continue;unique.add(key);
  const banner=document.createElement('div');banner.className='sale-banner';
  const name=document.createElement('strong');name.textContent=sale.name;banner.append(name);
  if(sale.expiresAt&&remainingSaleTime(sale.expiresAt)){
   const timer=document.createElement('span');timer.className='sale-countdown';timer.dataset.saleEnd=sale.expiresAt;timer.setAttribute('role','timer');banner.append(timer);
  }
  saleBanners.append(banner);
 }
 saleBanners.hidden=!saleBanners.childElementCount;updateCountdowns();
}
setInterval(()=>{
 let changed=false;
 if(campaign?.expiresAt&&remainingSaleTime(campaign.expiresAt)?.expired){campaign=null;campaignError=true;changed=true;}
 for(const [offer,sale] of Object.entries(publicCampaigns))if(sale.expiresAt&&remainingSaleTime(sale.expiresAt)?.expired){delete publicCampaigns[offer];changed=true;}
 if(changed)render();else updateCountdowns();
},1000);
function render(){
 const l=locales[lang],t=ui[lang];document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';
 if(gameEmbedded)parent.postMessage({type:'wonderlang-shop-ready'},'*');
 document.getElementById('heading').textContent=t[0];document.getElementById('language-label').textContent=t[2];document.getElementById('currency-label').textContent=t[3];
 renderSaleBanners();
 const grid=document.getElementById('offers');grid.replaceChildren();
 if(campaignLoading||campaignError){document.getElementById('status').textContent=campaignError?discountText[lang][0]:t[5];return;}
 if(campaign)document.getElementById('heading').textContent=campaign.name;
 let tabs=document.getElementById('platform-tabs');if(!tabs){tabs=document.createElement('nav');tabs.id='platform-tabs';grid.before(tabs)}tabs.replaceChildren();
 for(const [value,label] of [['desktop','PC / Mac'],['mobile',mobile[lang][4]],['both',mobile[lang][5]]]){const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-pressed',String(category===value));button.onclick=()=>{category=value;render()};tabs.append(button)}
 tabs.hidden=Boolean(campaign);tabs.style.display=campaign?"none":"";
 const offers=campaign?[campaign.offer]:category==='desktop'?['single','polyglot','premium']:category==='mobile'?['mobile_monthly','mobile_permanent','premium']:['premium'];
 const explicitCampaign=campaign;
 offers.forEach(offer=>{
 const campaign=explicitCampaign||publicCampaigns[offer];
 const card=document.createElement('article'),heading=document.createElement('h2'),price=document.createElement('div'),description=document.createElement('p'),buy=document.createElement('a'),options=rememberedOptions[offer]||{};rememberedOptions[offer]=options;
 const isMonthly=offer==='mobile_monthly',isMobile=offer.startsWith('mobile_'),index=['single','polyglot','premium'].indexOf(offer);
 heading.textContent=isMobile?mobile[lang][isMonthly?0:1]:l[offer];
 const amount=isMonthly?REGIONAL_PRICES.monthly[currency]:isMobile?prices[currency][1]:prices[currency][index];
 price.className='price';price.textContent=new Intl.NumberFormat(lang,{style:'currency',currency}).format(stripeMinorAmount(currency,amount)/10**currencyFractionDigits(currency))+(isMonthly?mobile[lang][6]:'');
 if(campaign){price.classList.add('sale-price');const regular=document.createElement('del');regular.textContent=price.textContent;regular.style.fontSize='0.6em';const minor=stripeMinorAmount(currency,amount);price.textContent=new Intl.NumberFormat(lang,{style:'currency',currency}).format((minor-Math.round(minor*campaign.percentOff/100))/10**currencyFractionDigits(currency))+(isMonthly?mobile[lang][6]:'');price.append(document.createTextNode(` (−${campaign.percentOff}%) `),regular);}
 description.className='description';description.textContent=isMobile?mobile[lang][isMonthly?2:3]:l[offer+'Description'];
 card.append(heading,price,description);
 if(campaign&&publicSales){const name=document.createElement('p');name.textContent=campaign.name;card.append(name);}
 if(campaign&&isMonthly){const terms=document.createElement('p');terms.textContent=discountText[lang][campaign.duration==='once'?1:campaign.duration==='forever'?2:3].replace('{MONTHS}',String(campaign.durationMonths));card.append(terms);}
 function update(){const params=new URLSearchParams({offer,lang,currency,...options});if(campaign)params.set('campaign',campaign.id);addAttribution(params,metaContext);for(const key of ['ttclid','gclid','gbraid','wbraid']){const value=query.get(key);if(value&&value.length<=255)params.set(key,value)}buy.href='/shop/checkout/?'+params}
 function choice(key,label,values){const wrapper=document.createElement('label'),text=document.createElement('span'),select=document.createElement('select');text.textContent=label;for(const [value,name]of values)select.add(new Option(name,value));if(campaign?.[key])options[key]=campaign[key];if(options[key])select.value=options[key];select.disabled=Boolean(campaign?.[key]);options[key]=select.value;select.onchange=()=>{options[key]=select.value;update()};wrapper.append(text,select);card.append(wrapper)}
 if(offer==='single')choice('learningLanguage',l.language,['french','spanish','german','italian','portuguese','korean','japanese','mandarin','english'].map((x,i)=>[x,l.languages[i]]));
 if(!isMobile)choice('delivery',l.delivery,[['steam',l.steam],['direct',l.direct]]);
 if(isMobile)choice('mobilePlatform',mobile[lang][4],[['android','Android']]);
 if(isMonthly){const trial=document.createElement('p');trial.textContent=mobile[lang][7];card.append(trial)}
 buy.className='buy';buy.textContent=t[1];buy.target='_blank';buy.rel='noopener';update();
 if(gameEmbedded)buy.addEventListener('click',event=>{
  event.preventDefault();
  // The game validates this iframe's origin/source and opens its system browser.
  // No payment, auth or private browser storage is hosted inside the game.
  parent.postMessage({type:'wonderlang-shop-checkout',url:buy.href},'*');
 });
 card.append(buy);grid.append(card);
 });
 document.getElementById('status').textContent='';
}
if(gameEmbedded)document.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&event.target.tagName!=='SELECT'){event.preventDefault();parent.postMessage({type:'wonderlang-shop-close'},'*');}
});
languageSelect.onchange=()=>{lang=languageSelect.value;render()};currencySelect.onchange=()=>{manualCurrency=true;currency=currencySelect.value;render()};render();
if(query.has('campaign'))fetch('/.netlify/functions/website-discount?id='+encodeURIComponent(query.get('campaign')),{cache:'no-store'}).then(async response=>{if(!response.ok)throw Error('Offer unavailable');campaign=await response.json();campaignLoading=false;render();}).catch(()=>{campaignLoading=false;campaignError=true;render();});
if(publicSales){
 async function refreshSales(){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
  try{
   const response=await fetch('/.netlify/functions/website-discount?placement=website',{cache:'no-store',signal:controller.signal});
   if(!response.ok)throw Error('Unavailable');
   const data=await response.json();
   publicCampaigns=Object.fromEntries(data.campaigns.filter(c=>!c.expiresAt||Date.parse(c.expiresAt)>Date.now()).map(c=>[c.offer,c]));
  }catch{publicCampaigns={};}finally{clearTimeout(timeout);}
  campaignLoading=false;render();
 }
 refreshSales();setInterval(refreshSales,60000);
 window.addEventListener('focus',refreshSales);
}
const expectedParent=query.get('parentOrigin');
window.addEventListener('message',event=>{
 if(event.source!==parent||!expectedParent||event.origin!==expectedParent||event.data?.type!=='wonderlang-shop-context')return;
 if(Object.hasOwn(locales,event.data.lang)){lang=event.data.lang;languageSelect.value=lang;languageSelect.closest('label').hidden=event.data.parentLanguage===true;render()}
});
new ResizeObserver(()=>{if(parent!==window)parent.postMessage({type:'wonderlang-shop-height',height:Math.ceil(document.querySelector('main').getBoundingClientRect().height)+4},expectedParent||'*')}).observe(document.querySelector('main'));
if(!manualCurrency)fetch('/shop/location.json',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(x=>{if(!manualCurrency&&x&&Object.hasOwn(prices,x.currency)){currency=x.currency;currencySelect.value=currency;render()}}).catch(()=>{});
