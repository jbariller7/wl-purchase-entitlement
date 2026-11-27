import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({create:vi.fn(),set:vi.fn(),get:vi.fn(),rate:vi.fn(),country:'FR'}));
vi.mock('@netlify/functions',()=>({getContext:()=>({ip:'192.0.2.20',geo:{country:{code:mocks.country}}})}));
vi.mock('../src/http/rate-limit.js',()=>({consumeRateLimit:mocks.rate}));
vi.mock('../src/infrastructure/firebase.js',()=>({firestore:()=>({doc:(path:string)=>({path,set:mocks.set}),runTransaction:async(fn:any)=>fn({get:mocks.get,create:mocks.create})})}));
import {lambdaHandler} from '../netlify/functions/steam-click.js';
const click={id:'1bd0b0ab-3a13-4369-b47a-424e1c47eaaa',visitorId:'1bd0b0ab-3a13-4369-b47a-424e1c47eaab',appId:'3599480',widget:'hero',page:'/',locale:'en',consent:true,utm:{utm_source:'meta',utm_medium:'paid',utm_campaign:'c',utm_content:'a',utm_term:'hero'},source:{}};
const call=(body:any=click,origin='https://wonderlang.app')=>(lambdaHandler as any)({httpMethod:'POST',headers:{origin,'user-agent':'Test Browser','x-country':'US','x-nf-client-connection-ip':'198.51.100.1'},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();mocks.country='FR';mocks.get.mockResolvedValue({exists:false});});
describe('Steam click collection',()=>{
 it('uses trusted Netlify country and IP instead of request headers',async()=>{expect((await call()).statusCode).toBe(200);expect(mocks.create.mock.calls[0]?.[1]).toMatchObject({country:'FR',ipAddress:'192.0.2.20',consent:true});});
 it('does not invent a country when geolocation is unavailable',async()=>{mocks.country='';await call();expect(mocks.create.mock.calls[0]?.[1].country).toBe('unknown');});
 it('is idempotent for a repeated click ID',async()=>{mocks.get.mockResolvedValue({exists:true});await call();expect(mocks.create).not.toHaveBeenCalled();});
 it('rejects other origins and invalid consent',async()=>{expect((await call(click,'https://example.com')).statusCode).toBe(403);expect((await call({...click,consent:false})).statusCode).toBe(400);expect(mocks.create).not.toHaveBeenCalled();});
 it('records consent withdrawal without retaining the visitor ID in the document path',async()=>{expect((await call({action:'withdraw',visitorId:click.visitorId})).statusCode).toBe(200);expect(mocks.set).toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();});
});
