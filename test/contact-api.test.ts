import {beforeEach,describe,it,expect,vi} from 'vitest';
import type {HandlerEvent} from '@netlify/aws-lambda-compat';
const mock=vi.hoisted(()=>({limit:vi.fn(async()=>({})),save:vi.fn(async()=>({accepted:true,id:'test'})),db:{}}));
vi.mock('../src/infrastructure/firebase.js',()=>({firestore:()=>mock.db}));
vi.mock('../src/http/rate-limit.js',()=>({consumeRateLimit:mock.limit}));
vi.mock('../src/email/purchase-confirmation.js',()=>({confirmationTransport:vi.fn()}));
vi.mock('../src/contact/service.js',async()=>{const original=await vi.importActual<any>('../src/contact/service.js');return {...original,saveContact:mock.save}});
import {lambdaHandler} from '../netlify/functions/contact.js';
const fields={id:'72debf8d-6eaf-4584-a35a-254fa6344e1d',name:'Test',email:'test@example.com',topic:'general',message:'A valid message for testing',locale:'en',website:''};
const event=(changes:any={})=>({httpMethod:'POST',headers:{origin:'https://wonderlang.app','content-type':'application/json','x-nf-client-connection-ip':'192.0.2.1'},body:JSON.stringify(fields),isBase64Encoded:false,...changes})as HandlerEvent;
const run=async(e:HandlerEvent)=>await lambdaHandler(e,{}as any)as any;
beforeEach(()=>vi.clearAllMocks());
describe('public contact endpoint',()=>{
 it('acknowledges only after the message is saved and all limits pass',async()=>{const r=await run(event());expect(r.statusCode).toBe(202);expect(mock.limit).toHaveBeenCalledTimes(3);expect(mock.save).toHaveBeenCalledTimes(1)});
 it.each([{httpMethod:'GET'},{headers:{origin:'https://attacker.example','content-type':'application/json'}},{body:'bad json'},{body:'x'.repeat(14001)},{body:JSON.stringify({...fields,website:'bot'})},{headers:{origin:'https://wonderlang.app','content-type':'application/json','x-forwarded-for':'192.0.2.1'}}])('rejects invalid requests %j',async changes=>{const r=await run(event(changes));expect(r.statusCode).toBeGreaterThanOrEqual(400);expect(mock.save).not.toHaveBeenCalled()});
 it('fails closed when request protection is unavailable',async()=>{mock.limit.mockRejectedValueOnce(new Error('offline'));const r=await run(event());expect(r.statusCode).toBe(500);expect(mock.save).not.toHaveBeenCalled()});
});
