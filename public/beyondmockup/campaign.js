'use strict';
const player=document.querySelector('#campaign-trailer');
document.querySelector('#watch-trailer').addEventListener('click',()=>{player.scrollIntoView({behavior:'smooth',block:'center'});player.play().catch(()=>{});});
let rewardData;
async function loadRewards(){return rewardData??=await fetch('rewards.json?v=vip-concise-20261022').then(r=>{if(!r.ok)throw Error('Rewards unavailable');return r.json();});}
function openLinkedTier(){const id=decodeURIComponent(location.hash.slice(1));const tier=document.getElementById(id);if(tier?.matches('details.reward-fold'))tier.open=true;}
addEventListener('hashchange',openLinkedTier);openLinkedTier();
const tabs=[...document.querySelectorAll('[data-tab]')];
function selectTab(id){tabs.forEach(a=>{const active=a.dataset.tab===id;a.classList.toggle('selected',active);if(active)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');});}
tabs.forEach(a=>a.addEventListener('click',()=>selectTab(a.dataset.tab)));
const tocLinks=[...document.querySelectorAll('.story-toc nav a')];
if('IntersectionObserver' in window){
 const sections=new IntersectionObserver(entries=>{for(const e of entries){if(!e.isIntersecting)continue;tocLinks.forEach(a=>a.classList.toggle('active',a.hash==='#'+e.target.id));selectTab(e.target.id==='whats-new'?'whats-new':e.target.id==='rewards'?'rewards':e.target.id==='faq'?'faq':e.target.id==='team'?'team':'story');}},{rootMargin:'-100px 0px -65% 0px'});
 document.querySelectorAll('#story section,#rewards,#faq').forEach(e=>sections.observe(e));
}

async function updateAddonEligibility(){
 const selector=document.querySelector('#addon-tier');if(!selector)return;
 try{
  const data=await loadRewards(),tier=data.tiers.find(t=>t.id===selector.value),caps=tier.allCapabilities;
  for(const addon of data.addons){
   const card=document.querySelector('[data-addon="'+addon.id+'"]'),status=card.querySelector('.addon-status');
   let state,text;
   if(addon.blockedBy && caps.includes(addon.blockedBy)){state='included';text='Already included in your reward · no add-on needed.';}
   else if(addon.requires && !caps.includes(addon.requires)){state='unavailable';text='Requires a Beyond game reward. Support the Adventure does not include a Beyond copy.';}
   else if(addon.isGift){state='available';text='Additional gift license for another person · +€'+addon.price+'.';}
   else{state='available';text='Available alongside '+tier.name+' · +€'+addon.price+'.';}
   card.dataset.status=state;status.textContent=text;
  }
 }catch{document.querySelectorAll('.addon-status').forEach(e=>e.textContent='See eligibility and included benefits below.');}
}
document.querySelector('#addon-tier')?.addEventListener('change',updateAddonEligibility);
updateAddonEligibility();
