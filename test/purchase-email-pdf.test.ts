import {describe,it,expect} from 'vitest';
import {renderConfirmation} from '../src/email/template.js';
import {emailCopy} from '../src/email/copy.js';
import {pdfCopy,freePdfLinks} from '../src/email/pdf-copy.js';

describe('purchase PDF downloads',()=>{
 it('includes both localized buttons and plain text URLs for every locale and purchase type',()=>{
  expect(Object.keys(pdfCopy).sort()).toEqual(Object.keys(emailCopy).sort());
  for(const locale of Object.keys(pdfCopy) as Array<keyof typeof pdfCopy>){
   for(const offer of ['single','polyglot','premium','mobile_monthly','mobile_permanent'] as const){
    const input={request:{offer,locale,currency:'USD',requestId:'b6d9ff25-0eab-4f2d-9d9f-1c2d79354f16',delivery:'steam' as const,mobilePlatform:'android' as const,learningLanguage:'french' as const},email:'preview@example.com',reference:'TEST',amount:100,currency:'usd',keys:['DUMMY']};
    const message=renderConfirmation(input);
    expect(message.html).toContain(pdfCopy[locale][0]);
    expect(message.html).toContain(`href="${freePdfLinks.primary}"`);
    expect(message.html).toContain(`href="${freePdfLinks.mirror.replaceAll('&','&amp;')}"`);
    expect(message.text).toContain(freePdfLinks.primary);
    expect(message.text).toContain(freePdfLinks.mirror);
    expect(message.html).toContain('bgcolor="#553291"');
    expect(renderConfirmation(input,'web').html).not.toContain(freePdfLinks.primary);
   }
  }
 });
 it('also includes downloads on subscription renewal emails',()=>{
  const message=renderConfirmation({request:{offer:'mobile_monthly',locale:'fr',currency:'EUR',requestId:'b6d9ff25-0eab-4f2d-9d9f-1c2d79354f16',mobilePlatform:'android'},email:'preview@example.com',reference:'TEST',amount:699,currency:'eur',keys:[],renewal:true});
  expect(message.text).toContain(freePdfLinks.primary);
 });
});
