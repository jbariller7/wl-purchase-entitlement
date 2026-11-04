import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({allocate:vi.fn(),send:vi.fn(),verify:vi.fn(),close:vi.fn()}));
vi.mock('../src/legacy/sheet-allocation.js',()=>({allocateSheetKey:mocks.allocate}));
vi.mock('../src/email/transport.js',()=>({confirmationTransport:()=>({sendMail:mocks.send,verify:mocks.verify,close:mocks.close})}));
import {sendAccessDelivery,queueAccessDelivery} from '../src/admin/access-delivery.js';
const id='b6d9ff25-0eab-4f2d-9d9f-1c2d79354f16';
function fixture(extra={}){
 const data=new Map<string,any>();
 const ref=(path:string):any=>({get:async()=>({exists:data.has(path),data:()=>data.get(path)}),set:async(v:any)=>{data.set(path,v);},update:async(v:any)=>{data.set(path,{...data.get(path),...v});}});
 const db:any={collection:(name:string)=>({doc:(id:string)=>ref(name+'/'+id)}),runTransaction:async(fn:any)=>fn({get:(r:any)=>r.get(),create:(r:any,v:any)=>r.set(v)})};
 const store:any={firestore:()=>db,enqueue:vi.fn()};
 const input={requestId:id,uid:'test',email:'buyer@example.com',product:'premium_lifetime_pass',mobilePlatform:'android' as const,delivery:'steam' as const,sendEmail:true,locale:'fr',actorUid:'owner',...extra};
 return {data,store,input,doc:()=>data.get('adminAccessDeliveries/'+id),job:{payload:{requestId:id}} as any};
}
beforeEach(()=>{vi.clearAllMocks();mocks.allocate.mockResolvedValue({key:'TEST-STEAM-KEY',sheetTab:'Polyglot Steam',rowNumber:2});mocks.send.mockResolvedValue({accepted:['buyer@example.com']});mocks.verify.mockResolvedValue(true);});
describe('Manual access fulfillment',()=>{
 it('assigns once, sends standard localized confirmation once and preserves sent status on replay',async()=>{const f=fixture();await queueAccessDelivery(f.store,f.input);await sendAccessDelivery(f.job,f.store);await sendAccessDelivery(f.job,f.store);expect(mocks.allocate).toHaveBeenCalledTimes(1);expect(mocks.send).toHaveBeenCalledTimes(1);expect(f.doc().emailState).toBe('sent');const mail=mocks.send.mock.calls[0]![0];expect(mail.to).toBe('buyer@example.com');expect(mail.text).toContain('TEST-STEAM-KEY');expect(mail.text).toContain('Télécharger les PDF');expect(mail.text).not.toContain('Montant payé');});
 it('does not allocate desktop content for mobile-only grants',async()=>{const f=fixture({product:'mobile_polyglot_permanent',delivery:'none'});await queueAccessDelivery(f.store,f.input);await sendAccessDelivery(f.job,f.store);expect(mocks.allocate).not.toHaveBeenCalled();expect(mocks.send.mock.calls[0]![0].text).toContain('Android');});
 it('retains the assigned key after a known email rejection and retries only mail',async()=>{const f=fixture();mocks.send.mockRejectedValueOnce(Object.assign(new Error('rejected'),{responseCode:550}));await queueAccessDelivery(f.store,f.input);await expect(sendAccessDelivery(f.job,f.store)).rejects.toThrow();expect(f.doc().emailState).toBe('failed');await sendAccessDelivery(f.job,f.store);expect(mocks.allocate).toHaveBeenCalledTimes(1);expect(f.doc().emailState).toBe('sent');});
 it('never blindly resends after an ambiguous SMTP timeout',async()=>{const f=fixture();mocks.send.mockRejectedValue(Object.assign(new Error('timeout'),{code:'ETIMEDOUT'}));await queueAccessDelivery(f.store,f.input);await expect(sendAccessDelivery(f.job,f.store)).rejects.toThrow();expect(f.doc().emailState).toBe('uncertain');await expect(sendAccessDelivery(f.job,f.store)).rejects.toThrow(/uncertain/);expect(mocks.send).toHaveBeenCalledTimes(1);});
 it('does not email when stock allocation fails or when sending was not requested',async()=>{const f=fixture();mocks.allocate.mockRejectedValueOnce(new Error('No available keys'));await queueAccessDelivery(f.store,f.input);await expect(sendAccessDelivery(f.job,f.store)).rejects.toThrow();expect(mocks.send).not.toHaveBeenCalled();const g=fixture({sendEmail:false});await queueAccessDelivery(g.store,g.input);await sendAccessDelivery(g.job,g.store);expect(mocks.send).not.toHaveBeenCalled();expect(g.doc().emailState).toBe('not_requested');});
 it('rejects changing a submitted delivery request while allowing identical replay',async()=>{const f=fixture();await queueAccessDelivery(f.store,f.input);await queueAccessDelivery(f.store,f.input);await expect(queueAccessDelivery(f.store,{...f.input,email:'other@example.com'})).rejects.toThrow(/different delivery/);});
});
