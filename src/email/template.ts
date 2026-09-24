import catalog from '../../catalog/website-checkout-locales.json' with {type:'json'};
import mobile from '../../catalog/website-mobile-locales.json' with {type:'json'};
import {emailCopy, emailLocale} from './copy.js';
import {webCopy} from './web-copy.js';
import type {WebsiteSessionRequest} from '../providers/stripe/website-session.js';
import {stripeMajorValue} from '../domain/regional-pricing.js';

export interface Confirmation {
 request: WebsiteSessionRequest;
 email: string;
 reference: string;
 amount: number;
 currency: string;
 country?: string | null | undefined;
 keys: string[];
 renewal?: boolean;
}
const escape = (v:string) => v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function privateDownloadUrl(value:string): string {
 const url = new URL(value);
 if(url.protocol!=='https:' || !(url.hostname==='itch.io' || url.hostname.endsWith('.itch.io')) || url.username || url.password)
  throw new Error('The assigned download link needs review.');
 return url.href;
}
export function renderConfirmation(input:Confirmation,channel:'email'|'web'='email') {
 const locale=emailLocale(input.request.locale,input.country), c=emailCopy[locale], p=catalog[locale], m=mobile[locale];
 const {offer,delivery,learningLanguage,mobilePlatform}=input.request;
 const isMobile=offer.startsWith('mobile_');
 const product=isMobile?m[offer==='mobile_monthly'?0:1]!:p[offer as 'single'|'polyglot'|'premium'];
 const description=isMobile?m[offer==='mobile_monthly'?2:3]!:p[`${offer as 'single'|'polyglot'|'premium'}Description`];
 const amount=new Intl.NumberFormat(locale,{style:'currency',currency:input.currency.toUpperCase()}).format(stripeMajorValue(input.currency,input.amount));
 const paragraphs=[c[1],product,description,`${c[2]}: ${amount}`,`${c[3]}: ${input.reference}`];
 if(learningLanguage){const index=['french','spanish','german','italian','portuguese','korean','japanese','mandarin','english'].indexOf(learningLanguage);paragraphs.push(`${p.language}: ${p.languages[index]}`);}
 if(isMobile)paragraphs.push(`${m[4]}: ${mobilePlatform==='ios'?'iOS':'Android'}`);
 const account=`https://wonderlang.app/account/?lang=${encodeURIComponent(locale)}`;
 const parts=paragraphs.map(v=>`<p>${escape(v)}</p>`);
 const add=(v:string)=>{paragraphs.push(v);parts.push(`<p>${escape(v)}</p>`);};
 add(c[4]);add(input.email);
 paragraphs.push(account);parts.push(`<p><a href="${account}" style="color:#553291;font-weight:bold">wonderlang.app/account</a></p>`);
 if(isMobile || offer==='premium')add(c[5]);
 if(mobilePlatform==='android' || offer==='premium'){
  const play='https://play.google.com/store/apps/details?id=com.wonderlang.app';
  paragraphs.push(`Google Play: ${play}`);parts.push(`<p><a href="${play}">WonderLang — Google Play</a></p>`);
 }
 if(offer==='premium' || mobilePlatform==='ios')add(c[10]);
 if(offer==='mobile_monthly')add(c[8]);
 if(!isMobile && !input.renewal){
  if(!input.keys.length && channel==='email')throw new Error('Delivery is not ready.');
  add(!input.keys.length?webCopy[locale][1]:delivery==='steam'?c[6]:c[7]);
  for(const key of input.keys){
   if(delivery==='direct'){
    const url=privateDownloadUrl(key);paragraphs.push(url);parts.push(`<p style="overflow-wrap:anywhere"><a href="${escape(url)}">${escape(p.direct)}</a></p>`);
   }else{paragraphs.push(key);parts.push(`<p dir="ltr" style="font-family:monospace;font-size:20px;background:#f1edf7;padding:16px">${escape(key)}</p>`);}
  }
 }
 if(channel==='web'){
  paragraphs.push(`${webCopy[locale][0]} orders@wonderlang.app`);
  parts.push(`<p>${escape(webCopy[locale][0])} <a href="mailto:orders@wonderlang.app">orders@wonderlang.app</a></p>`);
 }else add(c[9]);
 return {locale,subject:c[0],contentHtml:parts.join(''),text:paragraphs.join('\n\n'),html:`<!doctype html><html lang="${locale}" dir="${locale==='ar'?'rtl':'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f1f8;color:#251b35;font-family:Arial,sans-serif"><div style="max-width:600px;margin:24px auto;padding:28px;background:white;border-top:6px solid #edbc2d;border-radius:12px;font-size:16px;line-height:1.6;overflow-wrap:anywhere;word-wrap:break-word"><div style="font-weight:bold;letter-spacing:3px;color:#624184">WONDERLANG</div><h1 style="font-size:25px">${escape(c[0])}</h1>${parts.join('')}</div></body></html>`};
}
