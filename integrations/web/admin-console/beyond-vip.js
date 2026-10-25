const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const eur=n=>new Intl.NumberFormat('en',{style:'currency',currency:'EUR'}).format(n/100);
const endpoint='/admin-api/v1/beyond-vip';
export function vipMetaLabel(delivery){
 if(delivery?.receipt?.testEvent)return 'Accepted as a Meta test event';
 return ({accepted:'Accepted by Meta',pending:'Queued / retry scheduled',processing:'Sending',failed:'Delivery failed',opted_out:'Not sent: privacy opt-out',historical:'Not sent: predates tracking',disabled:'Not sent: tracking disabled',outside_window:'Not sent: outside reporting window',record_unavailable:'Delivery record no longer available',not_queued:'No delivery record',eligible:'Not queued'})[delivery?.status]||'No delivery record';
}
export function vipFilterQuery(filters,cursor){
 const p=new URLSearchParams();for(const k of ['tier','state','q'])if(filters[k])p.set(k,filters[k]);if(cursor)p.set('cursor',cursor);return p.size?'?'+p:'';
}
export function vipCsv(records){
 const cell=v=>{let s=String(v??'');if(/^[\s]*[=+@\-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'};
 const keys=['email','tierId','tierName','normalEurCents','vipEurCents','reservationAmount','reservationCurrency','chargedAmount','chargedCurrency','amountRefunded','state','eligible','createdAt','stripeSessionId','stripePaymentIntentId','termsVersion'];
 const metaKeys=['metaStatus','metaEventId','metaAcceptedAt','metaAttempts','metaMatchFields','metaTestEvent'];
 return '\uFEFF'+[[...keys,...metaKeys].map(cell).join(','),...records.map(r=>[...keys.map(k=>cell(r[k])),...[
  vipMetaLabel(r.metaDelivery),r.metaDelivery?.eventId,r.metaDelivery?.completedAt,r.metaDelivery?.attempts,
  r.metaDelivery?.receipt?.matchFields?.join(';'),r.metaDelivery?.receipt?.testEvent
 ].map(cell)].join(','))].join('\r\n');
}
export async function allFilteredVipRecords(api,filters,progress=()=>{}){
 const found=new Map(),seen=new Set();let cursor;
 do{
  const page=await api(endpoint+vipFilterQuery(filters,cursor));
  for(const r of page.reservations||[])found.set(r.id,r);
  progress(found.size);cursor=page.nextCursor;
  if(cursor){if(seen.has(cursor))throw Error('Export stopped because the pagination cursor did not advance.');seen.add(cursor)}
 }while(cursor);
 return [...found.values()];
}
export function renderVip(data){
 const f=data.filters||{},tiers=data.tiers||[];
 return `<section class="panel"><h2>Beyond VIP reservations</h2><p>Every verified US$1 reservation is saved here with the checkout email, selected reward and payment reference. The reservation fee is separate from the later Kickstarter pledge.</p><form id="vip-filters" class="stack-form"><div class="definition-grid"><label>Reward tier<select name="tier"><option value="">All rewards</option>${tiers.map(t=>`<option value="${esc(t.id)}" ${f.tier===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label><label>Payment status<select name="state"><option value="">All statuses</option>${['paid','refunded','disputed'].map(s=>`<option value="${s}" ${f.state===s?'selected':''}>${s==='paid'?'Paid / VIP eligible':s[0].toUpperCase()+s.slice(1)}</option>`).join('')}</select></label><label>Email contains<input name="q" type="search" value="${esc(f.q||'')}" placeholder="Customer email"></label></div><button class="button primary">Apply filters</button></form><p id="vip-count" role="status"></p><button class="button secondary" id="vip-export">Export all matching reservations (CSV)</button><p class="panel-copy">Export includes every matching record across all database pages, not just the records currently displayed.</p><div id="vip-rows"></div><button class="button secondary" id="vip-more" hidden>Load more matching reservations</button><p class="panel-copy">Refund requests: jonathan@wonderlang.app. Issue refunds in Stripe and use Refresh payment status to check eligibility. Refunded or disputed reservations are not eligible for secret rewards.</p></section>`;
}
function rows(list){return list.length?list.map(r=>{
 const currency=String(r.chargedCurrency).toUpperCase(),fmt=new Intl.NumberFormat('en',{style:'currency',currency}),paid=fmt.format(r.chargedAmount/10**fmt.resolvedOptions().maximumFractionDigits);
 return `<details class="panel vip-row"><summary><strong>${esc(r.email)}</strong> · ${esc(r.tierName)} · ${esc(r.state)} ${r.eligible?'· VIP eligible':''}</summary><p>Normal ${eur(r.normalEurCents)} · VIP ${eur(r.vipEurCents)} · 30% off</p><p>Paid ${esc(paid)} · ${esc(r.createdAt)}</p><p>Stripe session: ${esc(r.id)}</p><p><strong>Meta: ${esc(vipMetaLabel(r.metaDelivery))}</strong><br>Event ID: ${esc(r.metaDelivery?.eventId||'None')}<br>Attempts: ${esc(r.metaDelivery?.attempts??'Unknown')}${r.metaDelivery?.completedAt?'<br>Accepted at: '+esc(r.metaDelivery.completedAt):''}${r.metaDelivery?.nextAttemptAt?'<br>Next attempt: '+esc(r.metaDelivery.nextAttemptAt):''}${r.metaDelivery?.receipt?'<br>Matching fields supplied: '+esc(r.metaDelivery.receipt.matchFields?.join(', ')||'None'):''}</p><p class="panel-copy">Accepted means the server received Meta�s acknowledgement. It does not confirm ad attribution or browser delivery. Apply filters again to refresh this view.</p><a href="https://dashboard.stripe.com/payments/${encodeURIComponent(r.stripePaymentIntentId)}" target="_blank" rel="noopener noreferrer">Open payment in Stripe</a> <button class="button secondary" data-vip-refresh="${esc(r.id)}">Refresh payment status</button></details>`;
 }).join(''):'<p>No matching paid reservations.</p>'}
export function bindVip({api,toast},initial){
 let filters=initial.filters||{},loaded=[...(initial.reservations||[])],cursor=initial.nextCursor,busy=false;
 const form=document.getElementById('vip-filters'),more=document.getElementById('vip-more'),count=document.getElementById('vip-count'),exportButton=document.getElementById('vip-export');
 const render=()=>{document.getElementById('vip-rows').innerHTML=rows(loaded);more.hidden=!cursor;count.textContent=loaded.length+' matching reservation(s) displayed.'+(cursor?' More records are available.':' All matching records loaded.');};
 const readFilters=()=>Object.fromEntries(new FormData(form));
 async function load(reset){
  if(busy)return;busy=true;more.disabled=true;
  try{
   if(reset){filters=readFilters();loaded=[];cursor=undefined}
   let pages=0;
   do{const page=await api(endpoint+vipFilterQuery(filters,cursor));loaded.push(...page.reservations);cursor=page.nextCursor;pages++;}while(cursor&&!loaded.length&&pages<20);
   render();
  }catch(error){toast(error.message,true)}finally{busy=false;more.disabled=false}
 }
 form.addEventListener('submit',e=>{e.preventDefault();load(true)});more.addEventListener('click',()=>load(false));
 document.getElementById('vip-rows').addEventListener('click',async e=>{
  const b=e.target.closest('[data-vip-refresh]');if(!b||busy)return;b.disabled=true;
  try{await api(endpoint+'/'+encodeURIComponent(b.dataset.vipRefresh)+'/refresh',{method:'POST',body:{}});await load(true);toast('Stripe payment status refreshed.')}catch(error){toast(error.message,true)}finally{b.disabled=false}
 });
 exportButton.addEventListener('click',async()=>{
  if(busy)return;busy=true;exportButton.disabled=true;
  try{
   const chosen=readFilters(),records=await allFilteredVipRecords(api,chosen,n=>count.textContent='Preparing export: '+n+' matching record(s)…');
   const url=URL.createObjectURL(new Blob([vipCsv(records)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='WonderLang-Beyond-VIP-'+(chosen.tier||'all-rewards')+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(records.length+' matching reservation(s) exported.');
  }catch(error){toast(error.message,true)}finally{busy=false;exportButton.disabled=false;render()}
 });
 render();if(cursor&&!loaded.length)load(false);
}
