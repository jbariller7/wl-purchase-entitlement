import { withLambda,type LambdaHandler } from '@netlify/aws-lambda-compat';
import { z } from 'zod';
import { enroll,experimentToken,eventName,recordExperiment,withdraw } from '../../src/analytics/website-experiments.js';
import { firestore } from '../../src/infrastructure/firebase.js';
import { json,errorResponse,parseJsonBody } from '../../src/http/response.js';
import { consumeRateLimit } from '../../src/http/rate-limit.js';
import { HttpError } from '../../src/http/auth.js';
import { requestHeader } from '../../src/http/origin.js';
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('enroll'),visitorId:z.string().uuid(),locale:z.enum(['en','fr','es']),device:z.enum(['mobile','desktop']),source:z.enum(['direct','paid','email','social','other']).default('direct')}).strict(),
 z.object({action:z.literal('event'),token:experimentToken,event:eventName.exclude(['checkout','trial'])}).strict(),
 z.object({action:z.literal('withdraw'),token:experimentToken}).strict()
]);
export const lambdaHandler:LambdaHandler=async event=>{try{
 if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});
 if(requestHeader(event.headers,'origin')!=='https://wonderlang.app')throw new HttpError(403,'Invalid origin');
 if((event.body?.length||0)>1500)throw new HttpError(400,'Request too large');
 const parsed=schema.safeParse(parseJsonBody(event.body));if(!parsed.success)throw new HttpError(400,'Invalid measurement request');const input=parsed.data;
 if(/bot|crawler|spider|headless|facebookexternalhit|preview|lighthouse/i.test(requestHeader(event.headers,'user-agent')||''))return json(200,{enrollment:null});
 const db=firestore();await consumeRateLimit({db,namespace:'api',subject:requestHeader(event.headers,'x-nf-client-connection-ip')||'unknown',policy:{action:'website-measurement',limit:120,windowSeconds:60},now:new Date()});
 if(input.action==='enroll'){const raw=requestHeader(event.headers,'x-country')||'';return json(200,{enrollment:await enroll(db,input,/^[A-Z]{2}$/.test(raw)?raw:'unknown')})}
 if(input.action==='withdraw')await withdraw(db,input.token);else await recordExperiment(db,input.token,input.event);
 return json(200,{ok:true});
 }catch(error){return errorResponse(error)}};
export default withLambda(lambdaHandler);
