'use strict';
const query=new URLSearchParams(location.search),title=document.getElementById('reservation-title'),status=document.getElementById('reservation-status'),retry=document.getElementById('reservation-retry');
async function check(){
 retry.hidden=true;
 try{
  const session=query.get('session_id'),token=query.get('token');if(!session||!token)throw Error('Use the confirmation link provided after your Stripe checkout.');
  const response=await fetch('/.netlify/functions/beyond-vip?action=status&session_id='+encodeURIComponent(session)+'&token='+encodeURIComponent(token),{cache:'no-store'});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Payment could not be checked yet. Please try again.');
  if(data.eligible){title.textContent='Your VIP access is reserved!';status.textContent='Payment verified · '+data.tierName;document.getElementById('reservation-next').hidden=false;}
  else{title.textContent=data.state==='pending'?'Payment is still pending':'Reservation is not active';status.textContent='Stripe status: '+data.state+'. Contact jonathan@wonderlang.app if you need help.';retry.hidden=false;}
 }catch(error){title.textContent='We could not confirm your reservation yet';status.textContent=error.message+' If you already paid, do not pay again. Keep your Stripe receipt and email jonathan@wonderlang.app for help.';retry.hidden=false;}
}
retry.addEventListener('click',check);check();
