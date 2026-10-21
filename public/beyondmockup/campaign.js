'use strict';
const player=document.querySelector('#campaign-trailer');
document.querySelector('#watch-trailer').addEventListener('click',()=>{player.scrollIntoView({behavior:'smooth',block:'center'});player.play().catch(()=>{});});
const dialog=document.querySelector('#reward-preview');
let rewardData;
async function showReward(id){
 try{
  rewardData??=await fetch('rewards.json').then(r=>{if(!r.ok)throw Error('Rewards unavailable');return r.json();});
  const tier=rewardData.tiers.find(r=>r.id===id);if(!tier)return;
  document.querySelector('#reward-dialog-title').textContent=tier.name;
  const price=document.querySelector('#reward-dialog-price');price.replaceChildren(document.createTextNode('€'+tier.price.toLocaleString('en')));
  const hint=document.createElement('small');hint.textContent='Illustrative pledge amount';price.append(hint);
  document.querySelector('#reward-dialog-description').textContent=tier.text;
  const list=document.querySelector('#reward-dialog-items');list.replaceChildren(...tier.items.map(t=>{const li=document.createElement('li');li.textContent=t;return li;}));
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
