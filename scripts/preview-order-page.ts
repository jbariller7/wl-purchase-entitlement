import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {renderConfirmation} from '../src/email/template.js';
const output='backups/order-page-previews';mkdirSync(output,{recursive:true});
for(const locale of ['en','ar']){
 const result=renderConfirmation({request:{offer:'premium',delivery:'steam',locale,currency:'EUR',requestId:'b6d9ff25-0eab-4f2d-9d9f-1c2d79354f16'},email:'preview@example.com',reference:'PREVIEW-NOT-A-REAL-ORDER',amount:1900,currency:'eur',keys:['DEMO-ONLY-NOT-A-REAL-KEY']},'web');
 const html=readFileSync('public/shop/complete/index.html','utf8').replace(/<script[^>]*><\/script>/g,'').replace('<html lang="en">',`<html lang="${locale}" dir="${locale==='ar'?'rtl':'ltr'}">`).replace('id="title">Your WonderLang order',`id="title">${result.subject}`).replace(/<section id="content"[^>]*>[\s\S]*?<\/section>/,`<section id="content">${result.contentHtml}</section>`);
 writeFileSync(`${output}/${locale}.html`,html);
}
