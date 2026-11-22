import {beforeEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({issue:vi.fn(),sendMail:vi.fn(),limit:vi.fn()}));
vi.mock('../src/infrastructure/firebase.js',()=>({firebaseAuth:()=>({}),firestore:()=>({})}));
vi.mock('../src/identity/password-recovery.js',()=>({PasswordRecoveryService:class{issue=m.issue}}));
vi.mock('../src/email/transport.js',()=>({confirmationTransport:()=>({sendMail:m.sendMail})}));
vi.mock('../src/http/rate-limit.js',()=>({consumeRateLimit:m.limit}));
import {lambdaHandler} from '../netlify/functions/password-setup-request.js';
import {HttpError} from '../src/http/auth.js';
const run=(body:any)=>lambdaHandler({httpMethod:'POST',headers:{origin:'https://wonderlang.app','x-nf-client-connection-ip':'192.0.2.1'},body:JSON.stringify(body)} as any,{} as any) as Promise<any>;
beforeEach(()=>{vi.clearAllMocks();m.issue.mockResolvedValue({link:'https://wonderlang.app/account/#recovery=uid.secret'});m.sendMail.mockResolvedValue({accepted:['buyer@example.com']});});
it('emails the secret instead of returning it and applies IP and email rate limits',async()=>{
 const r=await run({email:'BUYER@example.com',locale:'fr'});
 expect(r.statusCode).toBe(200);expect(r.body).not.toContain('secret');expect(m.limit).toHaveBeenCalledTimes(2);
 expect(m.issue).toHaveBeenCalledWith(expect.objectContaining({email:'buyer@example.com',selfService:true}));
 expect(m.sendMail).toHaveBeenCalledWith(expect.objectContaining({to:'buyer@example.com',subject:'WonderLang — Définir ou réinitialiser votre mot de passe',text:expect.stringContaining('#recovery=uid.secret')}));
});
it('does not send mail when identity is ambiguous and does not expose account state',async()=>{
 m.issue.mockRejectedValueOnce(new HttpError(409,'Multiple accounts'));
 const r=await run({email:'buyer@example.com'});expect(r.statusCode).toBe(200);expect(m.sendMail).not.toHaveBeenCalled();
});
it('does not issue tokens after the request limit is reached',async()=>{
 m.limit.mockRejectedValueOnce(new HttpError(429,'Too many requests'));
 expect((await run({email:'buyer@example.com'})).statusCode).toBe(429);expect(m.issue).not.toHaveBeenCalled();
});
