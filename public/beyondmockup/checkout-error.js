'use strict';
const code=new URLSearchParams(location.search).get('code');
const key=code==='429'?'rateLimited':code==='400'?'badRequest':'unavailable';
const node=document.getElementById('checkout-error');
node.dataset.i18n=key;
node.textContent=JSON.parse(document.getElementById('beyond-language-config').textContent).messages[key];
