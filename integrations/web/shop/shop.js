import locales from '../../../catalog/website-checkout-locales.json';
import prices from '../../../catalog/website-prices.json';
import ui from '../../../catalog/website-shop-ui.json';
import mobile from '../../../catalog/website-mobile-locales.json';
import {REGIONAL_PRICES,stripeMinorAmount,currencyFractionDigits} from '../../../src/domain/regional-pricing.ts';
const native={en:'English',fr:'Français',de:'Deutsch',es:'Español','es-MX':'Español (Latinoamérica)','pt-BR':'Português (Brasil)','pt-PT':'Português (Portugal)',it:'Italiano',nl:'Nederlands',sv:'Svenska',pl:'Polski',uk:'Українська',ru:'Русский',id:'Bahasa Indonesia',ko:'한국어',ja:'日本語','zh-CN':'简体中文','zh-TW':'繁體中文',ar:'العربية',hy:'Հայերեն'};
const query=new URLSearchParams(location.search);
const browserLocale=navigator.language;
let lang=Object.hasOwn(locales,query.get('lang'))?query.get('lang'):Object.hasOwn(locales,browserLocale)?browserLocale:Object.hasOwn(locales,browserLocale.split('-')[0])?browserLocale.split('-')[0]:'en';
let currency=Object.hasOwn(prices,query.get('currency'))?query.get('currency'):'USD';
let manualCurrency=query.has('currency');
const embedded=query.get('embedded')==='1';
document.documentElement.classList.toggle('embedded',embedded);
const languageSelect=document.getElementById('language'),currencySelect=document.getElementById('currency');
for(const [value,label]of Object.entries(native))languageSelect.add(new Option(label,value));
for(const value of Object.keys(prices))currencySelect.add(new Option(value,value));
languageSelect.value=lang;currencySelect.value=currency;
languageSelect.closest('label').hidden=embedded&&query.get('parentLanguage')==='1';
const rememberedOptions={};
let category='desktop';
function render(){
 const l=locales[lang],t=ui[lang];document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';
 document.getElementById('heading').textContent=t[0];document.getElementById('language-label').textContent=t[2];document.getElementById('currency-label').textContent=t[3];
 const grid=document.getElementById('offers');grid.replaceChildren();
 let tabs=document.getElementById('platform-tabs');if(!tabs){tabs=document.createElement('nav');tabs.id='platform-tabs';grid.before(tabs)}tabs.replaceChildren();
 for(const [value,label] of [['desktop','PC / Mac'],['mobile',mobile[lang][4]],['both',mobile[lang][5]]]){const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-pressed',String(category===value));button.onclick=()=>{category=value;render()};tabs.append(button)}
 const offers=category==='desktop'?['single','polyglot','premium']:category==='mobile'?['mobile_monthly','mobile_permanent','premium']:['premium'];
 offers.forEach(offer=>{
 const card=document.createElement('article'),heading=document.createElement('h2'),price=document.createElement('div'),description=document.createElement('p'),buy=document.createElement('a'),options=rememberedOptions[offer]||{};rememberedOptions[offer]=options;
 const isMonthly=offer==='mobile_monthly',isMobile=offer.startsWith('mobile_'),index=['single','polyglot','premium'].indexOf(offer);
 heading.textContent=isMobile?mobile[lang][isMonthly?0:1]:l[offer];
 const amount=isMonthly?REGIONAL_PRICES.monthly[currency]:isMobile?prices[currency][1]:prices[currency][index];
 price.className='price';price.textContent=new Intl.NumberFormat(lang,{style:'currency',currency}).format(stripeMinorAmount(currency,amount)/10**currencyFractionDigits(currency))+(isMonthly?mobile[lang][6]:'');
 description.className='description';description.textContent=isMobile?mobile[lang][isMonthly?2:3]:l[offer+'Description'];
 card.append(heading,price,description);
 function update(){buy.href='/shop/checkout/?'+new URLSearchParams({offer,lang,currency,...options})}
 function choice(key,label,values){const wrapper=document.createElement('label'),text=document.createElement('span'),select=document.createElement('select');text.textContent=label;for(const [value,name]of values)select.add(new Option(name,value));if(options[key])select.value=options[key];options[key]=select.value;select.onchange=()=>{options[key]=select.value;update()};wrapper.append(text,select);card.append(wrapper)}
 if(offer==='single')choice('learningLanguage',l.language,['french','spanish','german','italian','portuguese','korean','japanese','mandarin','english'].map((x,i)=>[x,l.languages[i]]));
 if(!isMobile)choice('delivery',l.delivery,[['steam',l.steam],['direct',l.direct]]);
 if(isMobile)choice('mobilePlatform',mobile[lang][4],[['android','Android'],['ios','iOS']]);
 if(isMonthly){const trial=document.createElement('p');trial.textContent=mobile[lang][7];card.append(trial)}
 buy.className='buy';buy.textContent=t[1];buy.target='_blank';buy.rel='noopener';update();card.append(buy);grid.append(card);
 });
 document.getElementById('status').textContent='';
}
languageSelect.onchange=()=>{lang=languageSelect.value;render()};currencySelect.onchange=()=>{manualCurrency=true;currency=currencySelect.value;render()};render();
const expectedParent=query.get('parentOrigin');
window.addEventListener('message',event=>{
 if(event.source!==parent||!expectedParent||event.origin!==expectedParent||event.data?.type!=='wonderlang-shop-context')return;
 if(Object.hasOwn(locales,event.data.lang)){lang=event.data.lang;languageSelect.value=lang;languageSelect.closest('label').hidden=event.data.parentLanguage===true;render()}
});
new ResizeObserver(()=>{if(parent!==window)parent.postMessage({type:'wonderlang-shop-height',height:Math.ceil(document.querySelector('main').getBoundingClientRect().height)+4},expectedParent||'*')}).observe(document.querySelector('main'));
if(!manualCurrency)fetch('/shop/location.json',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(x=>{if(!manualCurrency&&x&&Object.hasOwn(prices,x.currency)){currency=x.currency;currencySelect.value=currency;render()}}).catch(()=>{});
