import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {renderConfirmation} from '../src/email/template.js';
import {emailCopy} from '../src/email/copy.js';
const output=resolve('backups/order-email-previews');mkdirSync(output,{recursive:true});
for(const locale of Object.keys(emailCopy))for(const offer of ['single','polyglot','premium','mobile_monthly','mobile_permanent'] as const){
 const message=renderConfirmation({request:{offer,locale,currency:'EUR',requestId:'b6d9ff25-0eab-4f2d-9d9f-1c2d79354f16',...(offer.startsWith('mobile_')?{mobilePlatform:'android' as const}:{delivery:'steam' as const}),...(offer==='single'?{learningLanguage:'french' as const}:{})},email:'preview@example.com',reference:'PREVIEW-NOT-A-REAL-ORDER',amount:offer==='mobile_monthly'?0:3099,currency:'eur',keys:['DEMO-ONLY-NOT-A-REAL-KEY']});
 writeFileSync(resolve(output,`${locale}-${offer}.html`),message.html);writeFileSync(resolve(output,`${locale}-${offer}.txt`),message.text);
}
console.log(`Created previews in ${output}`);
