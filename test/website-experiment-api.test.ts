import {beforeEach,it,expect,vi} from 'vitest';
const calls=vi.hoisted(()=>({enroll:vi.fn(),record:vi.fn(),withdraw:vi.fn(),limit:vi.fn(),configuration:vi.fn()}));
vi.mock('../src/infrastructure/firebase.js',()=>({firestore:()=>({})}));
vi.mock('../src/http/rate-limit.js',()=>({consumeRateLimit:calls.limit}));
vi.mock('../src/analytics/website-experiments.js',async importActual=>({...await importActual<any>(),enroll:calls.enroll,recordExperiment:calls.record,withdraw:calls.withdraw,homepageConfiguration:calls.configuration}));
import {lambdaHandler} from '../netlify/functions/website-experiment.js';
async function request(body:unknown,origin='https://wonderlang.app',ua='Mozilla/5.0'){
 return await (lambdaHandler as any)({httpMethod:'POST',body:JSON.stringify(body),headers:{origin,'user-agent':ua,'x-nf-client-connection-ip':'192.0.2.1'}},{});
}
beforeEach(()=>{vi.clearAllMocks();calls.enroll.mockResolvedValue(null)});
it('rejects browser attempts to submit a purchase or server checkout event',async()=>{
 for(const event of ['purchase','checkout','trial'])expect((await request({action:'event',token:'a'.repeat(64),event})).statusCode).toBe(400);
 expect(calls.record).not.toHaveBeenCalled();
});
it('rejects other origins and unexpected personal fields',async()=>{
 expect((await request({},'https://other.example')).statusCode).toBe(403);
 expect((await request({action:'enroll',visitorId:'550e8400-e29b-41d4-a716-446655440000',locale:'en',device:'desktop',email:'person@example.com'})).statusCode).toBe(400);
});
it('does not enroll known crawlers',async()=>{
 const r=await request({action:'enroll',visitorId:'550e8400-e29b-41d4-a716-446655440000',locale:'en',device:'desktop'},'https://wonderlang.app','Googlebot');
 expect(JSON.parse(r.body).enrollment).toBeNull();expect(calls.enroll).not.toHaveBeenCalled();
});
it('returns no enrollment while no test is active',async()=>{
 const r=await request({action:'enroll',visitorId:'550e8400-e29b-41d4-a716-446655440000',locale:'es',device:'mobile'});
 expect(r.statusCode).toBe(200);expect(JSON.parse(r.body).enrollment).toBeNull();expect(calls.limit).toHaveBeenCalled();
});
it('serves only the public default without enrolling or requiring measurement consent',async()=>{
 const config={defaultPage:{design:'page-12345678901234567890',variant:'B'}};calls.configuration.mockResolvedValue(config);
 const r=await (lambdaHandler as any)({httpMethod:'GET',headers:{}},{});
 expect(JSON.parse(r.body)).toEqual(config);expect(r.headers['cache-control']).toBe('no-store');expect(calls.enroll).not.toHaveBeenCalled();expect(calls.record).not.toHaveBeenCalled();
});
