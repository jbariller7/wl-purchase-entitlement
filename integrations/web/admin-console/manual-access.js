const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function accessReceipt(result,delivery){
 const email=delivery?.email||result.customer?.user?.email||'';
 const mail=({sent:'Confirmation email sent to '+email+(delivery?.sentAt?' at '+new Date(delivery.sentAt).toLocaleString():''),not_requested:'Confirmation email was not requested.',queued:'Confirmation email queued. Waiting for delivery.',sending:'Sending confirmation email…',failed:'Confirmation email has NOT been confirmed sent. A retry is scheduled.',uncertain:'Email delivery is uncertain. Check Workspace email logs before resending.'})[delivery?.emailState]||'Waiting for email status.';
 const assigned=delivery?.deliveryState==='assigned';
 return `<h3>${result.created?'Account created':'Existing account found'} — access granted</h3><p><strong>${esc(email)}</strong></p>${result.productLabel?`<p>${esc(result.productLabel)} &middot; ${esc(result.platform)}</p>`:''}<p>${assigned?(delivery.delivery==='steam'?'Steam key assigned:':'Direct download link assigned:'):'Desktop delivery: '+(delivery?.deliveryState==='not_required'?'not requested / not required.':'pending.')}</p>${assigned?`<p style="overflow-wrap:anywhere"><code>${esc(delivery.key)}</code></p>`:''}<p><strong>${esc(mail)}</strong></p>${delivery?.error?`<p role="alert">${esc(delivery.error)} Access remains granted.</p>`:''}<button type="button" class="button secondary" data-access-status>Refresh delivery status</button>`;
}
export function bindManualAccess({api,demo,onCustomer}){
 const form=document.querySelector('#create-customer-form');if(!form)return;
 let requestId=crypto.randomUUID(),result=null,timer=null;
 const status=document.querySelector('#create-customer-status'),button=form.querySelector('button[type=submit]');
 const sync=()=>{const premium=form.elements.product.value==='premium_lifetime_pass';form.querySelector('[data-desktop-delivery]').hidden=!premium;form.elements.delivery.disabled=!premium;form.querySelector('[data-email-language]').hidden=!form.elements.sendEmail.checked;};
 form.addEventListener('input',()=>{if(!result)requestId=crypto.randomUUID();sync();});sync();
 async function refresh(){clearTimeout(timer);if(!result||!status.isConnected)return;const current=result;try{const d=await api('/admin-api/v1/customer-deliveries/'+encodeURIComponent(result.deliveryId));if(result!==current)return;result.delivery=d;status.innerHTML=accessReceipt(result,d);if(d.state!=='complete'&&d.emailState!=='uncertain')timer=setTimeout(refresh,5000);}catch{if(result!==current)return;status.innerHTML=accessReceipt(result,result.delivery)+'<p>Could not refresh delivery status. Access is already granted. Use Refresh delivery status.</p>';}}
 status.addEventListener('click',e=>{if(e.target.closest('[data-access-status]'))refresh();});
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(button.disabled||result)return;
  const f=new FormData(form),controls=[...form.querySelectorAll('input,select,textarea,button')];controls.forEach(c=>c.disabled=true);status.textContent='Creating account and granting access…';
  try{
   if(demo)throw Error('Account creation is unavailable in the demo.');
   result=await api('/admin-api/v1/customers',{method:'POST',body:{email:f.get('email'),product:f.get('product'),mobilePlatform:f.get('mobilePlatform'),reason:f.get('reason'),requestId,delivery:f.get('delivery')||'none',sendEmail:f.get('sendEmail')==='on',locale:f.get('locale')||'en',...(f.get('endsAt')?{endsAt:new Date(f.get('endsAt')).toISOString()}:{} )}});
   result.productLabel=f.get('product')==='premium_lifetime_pass'?'Premium Lifetime Pass':'Polyglot Permanent Access';result.platform=f.get('mobilePlatform')==='ios'?'iOS':'Android';onCustomer(result.customer);status.innerHTML=accessReceipt(result,result.delivery);
   const next=document.createElement('button');next.type='button';next.className='button secondary';next.textContent='Create another account';next.addEventListener('click',()=>{clearTimeout(timer);result=null;requestId=crypto.randomUUID();form.reset();controls.forEach(c=>c.disabled=false);sync();next.remove();});form.appendChild(next);
   if(result.delivery?.state!=='complete')timer=setTimeout(refresh,2000);
  }catch(error){status.textContent=error.message;controls.forEach(c=>c.disabled=false);sync();}
 });
}
