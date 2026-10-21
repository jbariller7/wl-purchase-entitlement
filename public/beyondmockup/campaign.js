'use strict';
const player=document.querySelector('#campaign-trailer');
document.querySelector('#watch-trailer').addEventListener('click',()=>{player.scrollIntoView({behavior:'smooth',block:'center'});player.play().catch(()=>{});});
const dialog=document.querySelector('#reward-preview');
let rewardData;
async function loadRewards(){return rewardData??=await fetch('rewards.json?v=rewards-20261021').then(r=>{if(!r.ok)throw Error('Rewards unavailable');return r.json();});}
async function showReward(id){
 try{
  await loadRewards();
  const tier=rewardData.tiers.find(r=>r.id===id);if(!tier)return;
  document.querySelector('#reward-dialog-title').textContent=tier.emoji+' '+tier.name;
  const price=document.querySelector('#reward-dialog-price');price.replaceChildren(document.createTextNode('€'+tier.price.toLocaleString('en')));
  const hint=document.createElement('small');hint.textContent=tier.draftPrice?'Draft price · awaiting confirmation':'Pledge tier · campaign preview';price.append(hint);
  document.querySelector('#reward-dialog-description').textContent=tier.text;
  const list=document.querySelector('#reward-dialog-items');list.replaceChildren(...tier.allItems.map(t=>{const li=document.createElement('li');li.textContent=t;return li;}));
  const conditions=document.querySelector('#reward-dialog-conditions');conditions.replaceChildren(...tier.allConditions.map(t=>{const p=document.createElement('p');p.textContent=t;return p;}));
  dialog.showModal();
 }catch{document.querySelector('#rewards').scrollIntoView({behavior:'smooth'});}
}
document.querySelectorAll('[data-reward]').forEach(b=>b.addEventListener('click',()=>showReward(b.dataset.reward)));
document.querySelector('#close-preview').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
const tabs=[...document.querySelectorAll('[data-tab]')];
function selectTab(id){tabs.forEach(a=>{const active=a.dataset.tab===id;a.classList.toggle('selected',active);if(active)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');});}
tabs.forEach(a=>a.addEventListener('click',()=>selectTab(a.dataset.tab)));
const tocLinks=[...document.querySelectorAll('.story-toc nav a')];
if('IntersectionObserver' in window){
 const sections=new IntersectionObserver(entries=>{for(const e of entries){if(!e.isIntersecting)continue;tocLinks.forEach(a=>a.classList.toggle('active',a.hash==='#'+e.target.id));selectTab(e.target.id==='rewards'?'rewards':e.target.id==='faq'?'faq':e.target.id==='team'?'team':'story');}},{rootMargin:'-100px 0px -65% 0px'});
 document.querySelectorAll('#story section,#rewards,#faq').forEach(e=>sections.observe(e));
}

async function updateAddonEligibility(){
 const selector=document.querySelector('#addon-tier');if(!selector)return;
 try{
  const data=await loadRewards(),tier=data.tiers.find(t=>t.id===selector.value),caps=tier.allCapabilities;
  for(const addon of data.addons){
   const card=document.querySelector('[data-addon="'+addon.id+'"]'),status=card.querySelector('.addon-status');
   let state,text;
   if(caps.includes(addon.blockedBy)){state='included';text='Already included in your reward · no add-on needed.';}
   else if(!caps.includes('beyond')){state='unavailable';text='Choose a game reward first. The Supporter does not include a game copy.';}
   else if(caps.includes(addon.requires)){state='available';text='Available for '+tier.name+' · +€'+addon.price+' (draft).';}
   else{state='unavailable';text=addon.requires==='multi'?'Requires multiplatform access first.':'Requires The Complete Adventure or the preceding access upgrades first.';}
   card.dataset.status=state;status.textContent=text;
  }
 }catch{document.querySelectorAll('.addon-status').forEach(e=>e.textContent='See eligibility and included benefits below.');}
}
document.querySelector('#addon-tier')?.addEventListener('change',updateAddonEligibility);
updateAddonEligibility();
