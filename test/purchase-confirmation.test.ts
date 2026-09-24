import {afterEach,describe,expect,it,vi} from 'vitest';
import {emailCopy,emailLocale} from '../src/email/copy.js';
import {privateDownloadUrl,renderConfirmation,type Confirmation} from '../src/email/template.js';
const mocks=vi.hoisted(()=>({send:vi.fn(),close:vi.fn(),session:vi.fn(),invoice:vi.fn(),payment:vi.fn(),keys:vi.fn(),sessions:vi.fn()}));
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:mocks.send,close:mocks.close})}}));
vi.mock('../src/providers/stripe/website-config.js',()=>({websiteStripeClient:()=>({checkout:{sessions:{retrieve:mocks.session,list:mocks.sessions}},invoices:{retrieve:mocks.invoice},paymentIntents:{retrieve:mocks.payment}})}));
vi.mock('../src/legacy/website-delivery.js',()=>({websiteDelivery:mocks.keys}));
import {confirmationEligible,queueCheckoutConfirmation,queueInvoiceConfirmation,sendPurchaseConfirmation} from '../src/email/purchase-confirmation.js';
const base:Confirmation={request:{offer:'mobile_permanent',mobilePlatform:'android',locale:'en',currency:'EUR',requestId:'b6d9ff25-0eab-4f2d-9d9f-1c2d79354f16'},email:'buyer@example.com',reference:'cs_live_example',amount:3099,currency:'eur',keys:[]};
const original={...process.env};
afterEach(()=>{process.env={...original};vi.clearAllMocks();});
describe('localized purchase instructions',()=>{
 it('uses chosen language ahead of country and never guesses from an email',()=>{
  expect(emailLocale('fr','DE')).toBe('fr');expect(emailLocale(null,'DE')).toBe('de');expect(emailLocale('auto','BE')).toBe('en');expect(emailLocale('buyer@fr.example','US')).toBe('en');
 });
 for(const locale of Object.keys(emailCopy))it(`renders all current products in ${locale}`,()=>{
  for(const offer of ['single','polyglot','premium','mobile_monthly','mobile_permanent'] as const){
   const output=renderConfirmation({...base,request:{...base.request,locale,offer,delivery:'steam',learningLanguage:'french'},keys:['DEMO-ONLY-NOT-A-REAL-KEY']});
   expect(output.locale).toBe(locale);expect(output.text).not.toMatch(/undefined|\[object Object\]/);expect(output.html).toContain(`lang="${locale}"`);expect(output.text).toContain('buyer@example.com');
  }
 });
 it('explains web-first mobile activation and excludes desktop keys',()=>{
  const output=renderConfirmation(base);expect(output.text.indexOf('First, sign in')).toBeLessThan(output.text.indexOf('After signing in'));expect(output.text).toContain('No cloud saves');expect(output.text).not.toContain('Activate a Product');
 });
 it('includes Premium delivery and explains unreleased iOS',()=>{
  const output=renderConfirmation({...base,request:{...base.request,offer:'premium',delivery:'steam'},keys:['TEST-KEY']});expect(output.text).toContain('TEST-KEY');expect(output.text).toContain('iOS app is not released');
 });
 it('includes monthly cancellation terms and actual discounted amount',()=>{
  const output=renderConfirmation({...base,amount:325,request:{...base.request,offer:'mobile_monthly'}});expect(output.text).toContain('3.25');expect(output.text).toContain('cancel');
 });
 it('refuses missing desktop delivery and unsafe URLs; escapes content',()=>{
  expect(()=>renderConfirmation({...base,request:{...base.request,offer:'polyglot',delivery:'steam'}})).toThrow('Delivery');
  for(const url of ['javascript:alert(1)','https://evil.example/key','https://itch.io.evil.example/key'])expect(()=>privateDownloadUrl(url)).toThrow();
  expect(privateDownloadUrl('https://wonderlang.itch.io/game/download/example')).toContain('itch.io');
  expect(renderConfirmation({...base,reference:'<script>bad</script>'}).html).not.toContain('<script>');
 });
 it('formats zero and three-decimal currencies',()=>{
  expect(renderConfirmation({...base,currency:'jpy',amount:3600}).text).toContain('3,600');
  expect(renderConfirmation({...base,currency:'kwd',amount:5200}).text).toContain('5.200');
 });
});
it('queues only eligible live orders with a stable checkout deduplication key',async()=>{
 process.env.ORDER_EMAILS_START_AT='2026-09-24T12:00:00Z';const enqueue=vi.fn();const store={enqueue} as never;
 const session={id:'cs_live_example',livemode:true,payment_status:'paid',metadata:{wl_email_owner:'workspace-v1'}} as never;const event={created:Date.parse('2026-09-24T12:01Z')/1000} as never;
 await queueCheckoutConfirmation(store,session,event);expect(enqueue).toHaveBeenCalledWith('purchase_confirmation','checkout:cs_live_example',{sessionId:'cs_live_example'},expect.any(Date));
 expect(confirmationEligible(Date.parse('2026-09-23')/1000)).toBe(false);
 delete process.env.ORDER_EMAILS_START_AT;expect(confirmationEligible(Date.now()/1000)).toBe(false);
});
it('does not send a second creation confirmation for the initial subscription invoice',async()=>{
 process.env.ORDER_EMAILS_START_AT='2026-09-24T00:00:00Z';const enqueue=vi.fn();
 await queueInvoiceConfirmation({enqueue} as never,{id:'in_example',status:'paid',amount_paid:699,billing_reason:'subscription_create'} as never,{livemode:true,created:Date.now()/1000} as never,{metadata:{wl_checkout_flow:'website-session-v1',wl_email_owner:'workspace-v1'}} as never);
 expect(enqueue).not.toHaveBeenCalled();
});
it('queues post-trial payments and renewals by invoice ID, but leaves old MailerLite orders alone',async()=>{
 process.env.ORDER_EMAILS_START_AT='2026-09-24T00:00:00Z';const enqueue=vi.fn();
 const invoice={id:'in_example',status:'paid',amount_paid:699,billing_reason:'subscription_cycle'} as never;
 const event={livemode:true,created:Date.now()/1000} as never;
 await queueInvoiceConfirmation({enqueue} as never,invoice,event,{id:'sub_example',metadata:{wl_checkout_flow:'website-session-v1',wl_email_owner:'workspace-v1'}} as never);
 expect(enqueue).toHaveBeenCalledWith('purchase_confirmation','invoice:in_example',{invoiceId:'in_example',subscriptionId:'sub_example'},expect.any(Date));
 enqueue.mockClear();await queueCheckoutConfirmation({enqueue} as never,{id:'cs_old',livemode:true,payment_status:'paid',metadata:{}} as never,event);expect(enqueue).not.toHaveBeenCalled();
});
function fixture(state?:string){
 let record:Record<string,unknown>|undefined=state?{state}:undefined;
 const delivery={get:async()=>({data:()=>record}),update:vi.fn(async(v:object)=>{record={...record,...v};})};
 const order={get:async()=>({data:()=>({request:base.request,buyerEmail:base.email})})};
 const db={collection:(name:string)=>({doc:()=>name==='orderEmailDeliveries'?delivery:order}),runTransaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({get:delivery.get,set:(_ref:unknown,value:Record<string,unknown>)=>{record=value;}})};
 process.env.ORDER_EMAIL_SMTP_PASSWORD='test-only';
 mocks.session.mockResolvedValue({id:base.reference,livemode:true,payment_status:'paid',amount_total:3099,currency:'eur',payment_intent:'pi_example',customer_details:{email:base.email}});
 mocks.payment.mockResolvedValue({latest_charge:{refunded:false,disputed:false,amount_refunded:0}});
 mocks.send.mockResolvedValue({accepted:[base.email]});
 return {store:{firestore:()=>db} as never,record:()=>record,job:{id:'job',dedupeKey:'checkout:'+base.reference,payload:{sessionId:base.reference}} as never};
}
it('records a successful delivery and never sends it again on a replay',async()=>{
 const f=fixture();await sendPurchaseConfirmation(f.job,f.store);await sendPurchaseConfirmation(f.job,f.store);expect(mocks.send).toHaveBeenCalledTimes(1);expect(f.record()?.state).toBe('sent');
 expect(mocks.send.mock.calls[0]?.[0]).toMatchObject({from:{address:'orders@wonderlang.app'},to:{address:base.email},replyTo:'orders@wonderlang.app'});
});
it('does not send for a mismatched recipient or refunded payment',async()=>{
 const f=fixture();mocks.session.mockResolvedValueOnce({livemode:true,payment_status:'paid',customer_details:{email:'other@example.com'}});await expect(sendPurchaseConfirmation(f.job,f.store)).rejects.toThrow('recipient');
 mocks.payment.mockResolvedValueOnce({latest_charge:{refunded:true}});expect(await sendPurchaseConfirmation(f.job,f.store)).toEqual({emailState:'suppressed'});expect(mocks.send).not.toHaveBeenCalled();
});
it('holds ambiguous SMTP outcomes instead of risking duplicates',async()=>{
 const f=fixture();mocks.send.mockRejectedValueOnce(Object.assign(new Error('lost acknowledgement'),{code:'ETIMEDOUT',command:'DATA'}));await expect(sendPurchaseConfirmation(f.job,f.store)).rejects.toThrow('uncertain');await expect(sendPurchaseConfirmation(f.job,f.store)).rejects.toThrow('uncertain');expect(mocks.send).toHaveBeenCalledTimes(1);expect(f.record()?.state).toBe('uncertain');
});
it('retries a known SMTP rejection',async()=>{
 const f=fixture();mocks.send.mockRejectedValueOnce(Object.assign(new Error('temporary rejection'),{responseCode:451}));await expect(sendPurchaseConfirmation(f.job,f.store)).rejects.toThrow('rejected');await sendPurchaseConfirmation(f.job,f.store);expect(mocks.send).toHaveBeenCalledTimes(2);expect(f.record()?.state).toBe('sent');
});
