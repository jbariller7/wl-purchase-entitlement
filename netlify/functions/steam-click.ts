import {withLambda,type LambdaHandler} from '@netlify/aws-lambda-compat';
import {getContext} from '@netlify/functions';
import {z} from 'zod';
import {firestore} from '../../src/infrastructure/firebase.js';
import {consumeRateLimit} from '../../src/http/rate-limit.js';
import {json,errorResponse,parseJsonBody} from '../../src/http/response.js';
import {HttpError} from '../../src/http/auth.js';
import {hash} from '../../src/ads/steam-reconciliation.js';
const small=z.string().max(200),fb=z.string().regex(/^fb\.\d+\.\d+\.[\w.-]+$/).max(4096).optional();
const schema=z.object({id:z.string().uuid(),visitorId:z.string().uuid(),appId:z.string().regex(/^\d{3,12}$/),widget:small,page:z.string().startsWith('/').max(200),locale:z.string().max(10),consent:z.literal(true),utm:z.object({utm_source:small,utm_medium:small,utm_campaign:small,utm_content:small,utm_term:small}).strict(),source:z.object({utm_source:small.optional(),utm_medium:small.optional(),utm_campaign:small.optional(),utm_content:small.optional(),utm_term:small.optional(),campaign_id:small.optional(),adset_id:small.optional(),ad_id:small.optional(),fbp:fb,fbc:fb}).strict()}).strict();
export const lambdaHandler:LambdaHandler=async event=>{try{
 if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});
 if(event.headers.origin!=='https://wonderlang.app')throw new HttpError(403,'Invalid origin');
 if(event.isBase64Encoded||(event.body?.length||0)>12000)throw new HttpError(400,'Invalid body');
 const context=getContext(),ip=context.ip||'',country=context.geo?.country?.code||'';
 const now=new Date(),db=firestore();
 await consumeRateLimit({db,namespace:'api',subject:ip||'unknown',policy:{action:'steam-click',limit:30,windowSeconds:60},now});
 const raw=parseJsonBody(event.body);
 const withdrawal=z.object({action:z.literal('withdraw'),visitorId:z.string().uuid()}).strict().safeParse(raw);
 if(withdrawal.success){await firestore().doc('steamWithdrawals/'+hash(withdrawal.data.visitorId)).set({withdrawnAt:new Date().toISOString()});return json(200,{ok:true});}
 const parsed=schema.safeParse(raw);if(!parsed.success)throw new HttpError(400,'Invalid click');
 const ua=event.headers['user-agent']||'';if(/bot|crawler|spider|headless|preview|lighthouse/i.test(ua))return json(200,{ignored:true});
 const ref=db.doc('steamClicks/'+parsed.data.id);
 await db.runTransaction(async tx=>{if((await tx.get(ref)).exists)return;tx.create(ref,{...parsed.data,country:/^[A-Z]{2}$/.test(country)?country:'unknown',createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+30*86400000),ipAddress:ip,userAgent:ua.slice(0,1024)});});
 return json(200,{ok:true});
 }catch(e){return errorResponse(e)}};
export default withLambda(lambdaHandler);
