import {afterEach,expect,it,vi} from 'vitest';
import {googlePurchaseBody,sendGoogleConversion} from '../src/ads/google-conversion.js';
const event={eventId:'in_verified',eventTime:Math.floor(Date.now()/1000),value:6.99,currency:'EUR',product:'mobile_full_monthly'};
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()});
it('sends only allowed fields and does not manufacture advertising consent',()=>{
 const body=googlePurchaseBody({...event,email:'never@example.test',ipAddress:'192.0.2.1'});
 expect(body).toMatchObject({consent:{ad_user_data:'DENIED'},events:[{name:'purchase',params:{value:6.99,transaction_id:'in_verified'}}]});
 expect(JSON.stringify(body)).not.toContain('never@example.test');
 expect(JSON.stringify(body)).not.toContain('192.0.2.1');
 expect(googlePurchaseBody({...event,clientId:'123.456'}).client_id).toBe('123.456');
 expect(()=>googlePurchaseBody({...event,value:0})).toThrow();
});
it('requires successful schema validation before collecting the event',async()=>{
 vi.stubEnv('GA4_MEASUREMENT_ID','G-TEST');vi.stubEnv('GA4_API_SECRET','test-only');
 const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({validationMessages:[{description:'invalid'}]}),{status:200}));
 vi.stubGlobal('fetch',fetch);
 await expect(sendGoogleConversion(event)).rejects.toThrow('schema');expect(fetch).toHaveBeenCalledTimes(1);
 fetch.mockReset().mockResolvedValueOnce(new Response(JSON.stringify({validationMessages:[]}),{status:200})).mockResolvedValueOnce(new Response(null,{status:204}));
 await sendGoogleConversion(event);expect(fetch).toHaveBeenCalledTimes(2);
 expect(fetch.mock.calls[1]?.[0]).toContain('/mp/collect?');
});
