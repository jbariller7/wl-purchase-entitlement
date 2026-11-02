import fs from 'node:fs';
import {renderConfirmation} from '../dist/src/email/template.js';
const examples=['en','fr'].map(locale=>{
 const m=renderConfirmation({request:{offer:'premium',delivery:'steam',locale,currency:'EUR',requestId:'b6d9ff25-0eab-4f2d-9d9f-1c2d79354f16'},email:'jonathan.bariller@gmail.com',reference:locale==='fr'?'EXEMPLE-AUCUN-ACHAT':'PREVIEW-NO-PURCHASE',amount:0,currency:'eur',keys:[locale==='fr'?'EXEMPLE-CLE-STEAM-NON-VALIDE':'PREVIEW-NOT-A-VALID-STEAM-KEY']});
 const banner=locale==='fr'?'EXEMPLE UNIQUEMENT — Aucun achat ni paiement. La clé Steam ci-dessous est fictive.':'PREVIEW ONLY — No purchase or payment. The Steam key below is a dummy.';
 return {...m,subject:(locale==='fr'?'EXEMPLE — ':'PREVIEW — ')+m.subject,html:m.html.replace('<body ', '<body ').replace('<h1 ',`<p style="padding:12px;background:#fff2bf;font-weight:bold">${banner}</p><h1 `),text:banner+'\n\n'+m.text};
});
fs.mkdirSync('backups/pdf-email-previews-20261102',{recursive:true});
for(const m of examples){fs.writeFileSync(`backups/pdf-email-previews-20261102/${m.locale}.html`,m.html);}
console.log(JSON.stringify(examples));
