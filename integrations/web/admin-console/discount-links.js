import prices from '../../../catalog/website-prices.json';
import {REGIONAL_PRICES,stripeMinorAmount,currencyFractionDigits} from '../../../src/domain/regional-pricing.ts';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let currentData;
const options=(values)=>Object.entries(values).map(([v,n])=>`<option value="${esc(v)}">${esc(n)}</option>`).join('');
const languageNames={en:'English',fr:'Français',de:'Deutsch',es:'Español','es-MX':'Español (Latinoamérica)','pt-BR':'Português (Brasil)','pt-PT':'Português (Portugal)',it:'Italiano',nl:'Nederlands',sv:'Svenska',pl:'Polski',uk:'Українська',ru:'Русский',id:'Bahasa Indonesia',ko:'한국어',ja:'日本語','zh-CN':'简体中文','zh-TW':'繁體中文',ar:'العربية',hy:'Հայերեն'};
const demoLinks=[];
export function demoDiscountLinks(path,options={}){
 const data={links:demoLinks,offers:{single:'Single language · PC/Mac',polyglot:'Polyglot · PC/Mac',premium:'Premium Lifetime Pass',mobile_monthly:'Mobile Monthly',mobile_permanent:'Mobile Permanent'},locales:Object.keys(languageNames),currencies:Object.keys(prices)};
 if((options.method||'GET')==='GET')return data;
 if(path.endsWith('/active')){const link=demoLinks.find(l=>path.includes(l.id));link.active=options.body.active;return link;}
 const link={...options.body,active:true,ready:true,url:location.origin+'/shop/?campaign='+options.body.id};demoLinks.unshift(link);return link;
}
export function renderDiscountLinks(data){
 currentData=data;
 const rows=data.links.map(link=>{
  const expired=link.expiresAt&&Date.parse(link.expiresAt)<=Date.now();
  const status=!link.ready?'Setup incomplete':expired?'Expired':link.active?'Active':'Inactive';
  return `<tr><td><strong>${esc(link.name)}</strong><br>${esc(data.offers[link.offer])}<br><small>${esc(link.locale)} · ${esc(link.currency)}</small></td><td>${link.percentOff}%<br><small>${link.offer==='mobile_monthly'?(link.duration==='once'?'First payment':link.duration==='forever'?'Every payment':`${link.durationMonths} months`):'One purchase'}</small></td><td>${esc(status)}</td><td>${link.expiresAt?esc(new Date(link.expiresAt).toLocaleString()):'No expiry'}</td><td><input aria-label="Link for ${esc(link.name)}" readonly value="${esc(link.url)}"><button class="text-button" data-copy-discount="${link.id}">Copy link</button> <a href="${esc(link.url)}" target="_blank" rel="noopener">Preview</a></td><td>${!link.ready?`<button class="text-button" data-provision-discount="${link.id}">Retry setup</button>`:!expired?`<button class="text-button" data-toggle-discount="${link.id}" data-active="${!link.active}">${link.active?'Deactivate':'Activate'}</button>`:''} <button class="text-button" data-duplicate-discount="${link.id}">Duplicate</button></td></tr>`;
 }).join('');
 return `<section class="page-intro"><p class="section-kicker">NEWSLETTER CAMPAIGNS</p><h2>Discount links</h2><p>Create reusable links to the normal Stripe checkout. Delivery, account access and sales reporting follow the existing website purchase flow.</p></section>
 <section class="panel"><header><div><h3>Create a discount link</h3><p class="panel-copy">The campaign name appears on Stripe checkout and its discount. Percentages apply to every supported currency. Existing product prices stay unchanged.</p></div></header>
 <form id="discount-link-form" class="stack-form">
 <label>Campaign name (shown to buyers)<input name="name" required maxlength="40" placeholder="Autumn newsletter"></label>
 <label>Product<select name="offer">${options(data.offers)}</select></label>
 <label>Discount (%)<input name="percentOff" type="number" min="1" max="100" step="1" value="20" required></label>
 <label>Default checkout language<select name="locale">${options(Object.fromEntries(data.locales.map(l=>[l,languageNames[l]||l])))}</select></label>
 <label>Default currency (buyers can change it)<select name="currency">${options(Object.fromEntries(data.currencies.map(c=>[c,c])))}</select></label>
 <label data-discount-desktop>Delivery<select name="delivery"><option value="">Buyer chooses</option><option value="steam">Steam key</option><option value="direct">Direct download</option></select></label>
 <label data-discount-single>Learning language<select name="learningLanguage"><option value="">Buyer chooses</option>${options({french:'French',spanish:'Spanish',german:'German',italian:'Italian',portuguese:'Portuguese',korean:'Korean',japanese:'Japanese',mandarin:'Mandarin',english:'English'})}</select></label>
 <label data-discount-mobile>Mobile platform<select name="mobilePlatform"><option value="">Buyer chooses</option><option value="android">Android</option><option value="ios">iOS</option></select></label>
 <label data-discount-monthly>Subscription discount duration<select name="duration"><option value="once">First payment</option><option value="repeating">A number of months</option><option value="forever">Every payment</option></select></label>
 <label data-discount-months>Number of months<input name="durationMonths" type="number" min="1" max="36" step="1" value="3"></label>
 <label>Expiry date and time (your local time; optional)<input name="expiresAt" type="datetime-local"></label>
 <p class="panel-copy">Expiry and deactivation stop new checkouts. Unpaid Stripe sessions are closed automatically; deadline cleanup runs every minute. Already completed purchases and subscription discounts are honored. Monthly offers keep their existing three-day trial.</p>
 <details><summary>Preview all currency prices</summary><div id="discount-price-preview" class="table-wrap"></div></details>
 <button class="button primary" type="submit">Create discount link</button><p id="discount-create-result" role="status"></p>
 </form></section>
 <section class="panel spaced"><header><h3>Your links</h3><label>Filter<select id="discount-filter"><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="expired">Expired</option></select></label></header>
 <div class="table-wrap"><table id="discount-links-table"><thead><tr><th>Name / product</th><th>Discount</th><th>Status</th><th>Expires</th><th>Newsletter link</th><th>Actions</th></tr></thead><tbody>${rows||'<tr><td colspan="6">No discount links yet.</td></tr>'}</tbody></table></div><p class="panel-copy">Latest 250 links. Use Duplicate to create a new campaign with different terms or dates.</p></section>`;
}
export function bindDiscountLinks({api,toast,reload}){
 const form=document.getElementById('discount-link-form');if(!form)return;
 let requestId=crypto.randomUUID();let submitting=false;
 form.elements.currency.value='USD';form.elements.locale.value='en';
 function update(){
  const offer=form.elements.offer.value,monthly=offer==='mobile_monthly',mobile=offer.startsWith('mobile_');
  for(const [selector,visible]of [['[data-discount-desktop]',!mobile],['[data-discount-single]',offer==='single'],['[data-discount-mobile]',mobile],['[data-discount-monthly]',monthly],['[data-discount-months]',monthly&&form.elements.duration.value==='repeating']]){const node=form.querySelector(selector);node.hidden=!visible;node.style.display=visible?"":"none";node.querySelectorAll('input,select').forEach(input=>input.disabled=!visible);}
  const percent=Number(form.elements.percentOff.value);
  const format=(minor,c)=>new Intl.NumberFormat(undefined,{style:'currency',currency:c}).format(minor/10**currencyFractionDigits(c));
  document.getElementById('discount-price-preview').innerHTML=`<table><thead><tr><th>Currency</th><th>Normal</th><th>Discounted</th></tr></thead><tbody>${currentData.currencies.map(c=>{const amount=monthly?REGIONAL_PRICES.monthly[c]:prices[c][offer==='single'?0:offer==='premium'?2:1];const minor=stripeMinorAmount(c,amount);return `<tr><td>${c}</td><td>${format(minor,c)}</td><td>${format(Math.max(0,minor-Math.round(minor*percent/100)),c)}</td></tr>`;}).join('')}</tbody></table><p>Indicative totals; Stripe determines final rounding. Very large non-zero discounts are subject to Stripe’s minimum charge amounts. Subscription duration is shown above.</p>`;
 }
 form.addEventListener('input',update);form.addEventListener('change',()=>{requestId=crypto.randomUUID();update()});update();
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(submitting)return;submitting=true;const button=form.querySelector('[type=submit]');button.disabled=true;
  try{
   const f=new FormData(form);const body={id:requestId,name:String(f.get('name')).trim(),offer:f.get('offer'),percentOff:Number(f.get('percentOff')),locale:f.get('locale'),currency:f.get('currency'),duration:f.get('duration')||'once',expiresAt:f.get('expiresAt')?new Date(String(f.get('expiresAt'))).toISOString():null};
   for(const key of ['delivery','learningLanguage','mobilePlatform'])if(f.get(key))body[key]=f.get(key);
   if(body.duration==='repeating')body.durationMonths=Number(f.get('durationMonths'));
   const result=await api('/admin-api/v1/discount-links',{method:'POST',body});
   await reload();toast(`Created “${result.name}”. Copy its newsletter link below.`);
  }catch(error){toast(error.message,true);}finally{submitting=false;button.disabled=false;}
 });
 document.querySelectorAll('[data-copy-discount]').forEach(button=>button.onclick=async()=>{const link=currentData.links.find(l=>l.id===button.dataset.copyDiscount);try{await navigator.clipboard.writeText(link.url);toast('Link copied.')}catch{toast('Select and copy the link from its field.',true)}});
 document.querySelectorAll('[data-toggle-discount]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await api(`/admin-api/v1/discount-links/${button.dataset.toggleDiscount}/active`,{method:'POST',body:{active:button.dataset.active==='true'}});await reload();toast('Link status updated.')}catch(error){toast(error.message,true);button.disabled=false}});
 document.querySelectorAll('[data-provision-discount]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await api(`/admin-api/v1/discount-links/${button.dataset.provisionDiscount}/provision`,{method:'POST',body:{}});await reload();toast('Link setup completed.')}catch(error){toast(error.message,true);button.disabled=false}});
 document.querySelectorAll('[data-duplicate-discount]').forEach(button=>button.onclick=()=>{const link=currentData.links.find(l=>l.id===button.dataset.duplicateDiscount);requestId=crypto.randomUUID();form.reset();for(const key of ['name','offer','percentOff','locale','currency','delivery','learningLanguage','mobilePlatform','duration','durationMonths'])if(link[key]!=null)form.elements[key].value=link[key];form.elements.expiresAt.value='';update();form.scrollIntoView({behavior:'smooth'});form.elements.name.focus();});
 document.getElementById('discount-filter').onchange=event=>{const value=event.target.value;document.querySelectorAll('#discount-links-table tbody tr').forEach(row=>{row.hidden=value!=='all'&&row.cells[2]?.textContent.toLowerCase()!==value;});};
}
