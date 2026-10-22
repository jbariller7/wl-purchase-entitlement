'use strict';
const query=new URLSearchParams(location.search),title=document.getElementById('reservation-title'),status=document.getElementById('reservation-status'),retry=document.getElementById('reservation-retry');
const next=document.getElementById('reservation-next'),countdown=document.getElementById('reservation-countdown'),stay=document.getElementById('reservation-stay');
const KICKSTARTER_URL='https://www.kickstarter.com/projects/jonathan-wonderlang/wonderlang-beyond-a-language-learning-rpg-for-intermediates';
let redirectTimer=null,secondsRemaining=8;
function stopRedirect(){clearTimeout(redirectTimer);redirectTimer=null;}
function startRedirect(){
 stopRedirect();secondsRemaining=8;stay.hidden=false;
 function tick(){
  countdown.textContent='Opening Kickstarter in '+secondsRemaining+' second'+(secondsRemaining===1?'':'s')+'…';
  redirectTimer=setTimeout(()=>{secondsRemaining-=1;if(secondsRemaining===0){location.replace(KICKSTARTER_URL);return;}tick();},1000);
 }
 tick();
}
async function check(){
 stopRedirect();retry.hidden=true;next.hidden=true;
 try{
  const session=query.get('session_id'),token=query.get('token');if(!session||!token)throw Error('Use the confirmation link provided after your Stripe checkout.');
  const response=await fetch('/.netlify/functions/beyond-vip?action=status&session_id='+encodeURIComponent(session)+'&token='+encodeURIComponent(token),{cache:'no-store'});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Payment could not be checked yet. Please try again.');
  if(data.eligible===true&&data.state==='paid'){
   title.textContent='Thank you for joining the adventure!';status.textContent='Your payment is verified and your VIP reservation is saved · '+data.tierName;
   next.hidden=false;startRedirect();
  }
  else{title.textContent=data.state==='pending'?'Payment is still pending':'Reservation is not active';status.textContent='Stripe status: '+data.state+'. Contact jonathan@wonderlang.app if you need help.';retry.hidden=false;}
 }catch(error){title.textContent='We could not confirm your reservation yet';status.textContent=error.message+' If you already paid, do not pay again. Keep your Stripe receipt and email jonathan@wonderlang.app for help.';retry.hidden=false;}
}
stay.addEventListener('click',()=>{stopRedirect();countdown.textContent='Automatic redirect paused. Open Kickstarter whenever you’re ready.';stay.hidden=true;});
retry.addEventListener('click',check);check();
