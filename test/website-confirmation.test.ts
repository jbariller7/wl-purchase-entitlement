import {beforeEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {renderConfirmation} from '../src/email/template.js';
import {emailCopy} from '../src/email/copy.js';
const mocks=vi.hoisted(()=>({retrieve:vi.fn(),get:vi.fn(),keys:vi.fn()}));
vi.mock('../src/providers/stripe/website-config.js',()=>({websiteStripeConfiguration:()=>({origin:'https://wonderlang.app'}),websiteStripeClient:()=>({checkout:{sessions:{retrieve:mocks.retrieve}}})}));
vi.mock('../src/infrastructure/firebase.js',()=>({firestore:()=>({collection:()=>({doc:()=>({get:mocks.get})})})}));
vi.mock('../src/http/rate-limit.js',()=>({consumeRateLimit:vi.fn()}));
vi.mock('../src/legacy/website-delivery.js',()=>({websiteDelivery:mocks.keys}));
import {lambdaHandler} from '../netlify/functions/website-confirmation.js';
const secret='x'.repeat(43),request={offer:'premium' as const,delivery:'steam' as const,locale:'en',currency:'EUR',requestId:'b6d9ff25-0eab-4f2d-9d9f-1c2d79354f16'};
const session={id:'cs_live_example',livemode:true,status:'complete',payment_status:'paid',amount_total:1900,currency:'eur',customer_details:{email:'buyer@example.com'},metadata:{wl_request_id:request.requestId,wl_checkout_flow:'website-session-v1'}};
const call=async(claimSecret=secret,origin='https://wonderlang.app')=>await lambdaHandler({httpMethod:'POST',headers:{origin},body:JSON.stringify({sessionId:session.id,claimSecret})} as never,{} as never) as {statusCode:number;body:string};
beforeEach(()=>{vi.clearAllMocks();mocks.retrieve.mockResolvedValue(session);mocks.keys.mockResolvedValue([{key:'DEMO-KEY'}]);mocks.get.mockResolvedValue({data:()=>({sessionId:session.id,claimHash:createHash('sha256').update(secret).digest('hex'),request})});});
it('protects private order details with origin and checkout proof',async()=>{
 expect((await call(secret,'https://evil.test')).statusCode).toBe(403);
 expect((await call('a'.repeat(43))).statusCode).toBe(404);expect(mocks.keys).not.toHaveBeenCalled();
});
it('shows verified order and allocated key without claiming the account',async()=>{
 const response=await call();expect(response.statusCode).toBe(200);expect(response.body).toContain('DEMO-KEY');expect(response.body).toContain('mailto:orders@wonderlang.app');expect(response.body).not.toContain('Reply to this email');
 expect(JSON.parse(response.body).deliveryPending).toBe(false);
});
it('handles delayed key delivery and zero-cost trials without false failures',async()=>{
 mocks.keys.mockResolvedValue([]);expect(JSON.parse((await call()).body).deliveryPending).toBe(true);
 mocks.retrieve.mockResolvedValue({...session,payment_status:'no_payment_required',amount_total:0});expect((await call()).statusCode).toBe(200);
});
it('rejects unpaid, sandbox and refunded orders before exposing keys',async()=>{
 for(const [fields,status] of [[{status:'open',payment_status:'unpaid'},409],[{livemode:false},404],[{payment_intent:{latest_charge:{refunded:true}}},403]] as const){
  mocks.retrieve.mockResolvedValue({...session,...fields});expect((await call()).statusCode).toBe(status);
 }expect(mocks.keys).not.toHaveBeenCalled();
});
it('uses web support in every locale while retaining email wording',()=>{
 for(const locale of Object.keys(emailCopy)){
  const input={request:{...request,locale},email:'buyer@example.com',reference:session.id,amount:1900,currency:'eur',keys:['<script>bad</script>']};
  const web=renderConfirmation(input,'web'),email=renderConfirmation(input);
  expect(web.contentHtml).toContain('mailto:orders@wonderlang.app');expect(web.contentHtml).not.toContain('<script>');
  expect(email.text).toContain(emailCopy[locale as keyof typeof emailCopy][9]);
 }
});
