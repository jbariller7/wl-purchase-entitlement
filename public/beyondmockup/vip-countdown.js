/* One absolute deadline, independent of the visitor's time zone. No requests. */
(() => {
  const deadline = Date.parse('2026-11-09T08:00:00+01:00');
  const box = document.getElementById('vip-countdown');
  if (!box) return;
  let labels = {vipCountdownClosed:'VIP bookings are now closed',vipCountdownFollow:'Follow on Kickstarter'};
  const campaign = box.querySelector('a').href;
  function render() {
    const remaining = Math.max(0, Math.ceil((deadline-Date.now())/1000));
    const values = [Math.floor(remaining/86400), Math.floor(remaining/3600)%24, Math.floor(remaining/60)%60, remaining%60];
    box.querySelectorAll('[data-clock]').forEach((node,i)=>{node.textContent=String(values[i]).padStart(2,'0');});
    box.querySelector('time').textContent = new Intl.DateTimeFormat(document.documentElement.lang || 'en', {timeZone:'Europe/Paris',weekday:'long',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(deadline);
    if (remaining === 0) {
      box.classList.add('closed');
      box.querySelector('h2').textContent=labels.vipCountdownClosed;
      box.querySelector('.vip-clock').hidden=true;
      box.querySelector('a').hidden=false;
      document.querySelectorAll('a.vip-checkout').forEach(link=>{
        link.href=campaign;link.textContent=labels.vipCountdownFollow;
        link.setAttribute('aria-label',labels.vipCountdownFollow);
        link.dataset.vipClosed='true';
      });
    }
  }
  document.addEventListener('beyond:language',event=>{labels={...labels,...event.detail.text};render();});
  // Capture before attribution handlers: stale tabs cannot start new reservations.
  document.addEventListener('click',event=>{
    const link=event.target.closest?.('a.vip-checkout');
    if(link && Date.now()>=deadline){event.preventDefault();event.stopImmediatePropagation();location.assign(campaign);}
  },true);
  render();setInterval(render,1000);
})();
