import { withLambda, type LambdaHandler } from '@netlify/aws-lambda-compat';
import { websiteSessionSchema } from '../../src/providers/stripe/website-session.js';
import { startWebsiteCheckout } from '../../src/providers/stripe/website-commerce.js';
import { HttpError } from '../../src/http/auth.js';
import { errorResponse, json } from '../../src/http/response.js';
import { firestore } from '../../src/infrastructure/firebase.js';
import { EntitlementStore } from '../../src/infrastructure/entitlement-store.js';
import { consumeRateLimit } from '../../src/http/rate-limit.js';
import {websiteStripeConfiguration} from '../../src/providers/stripe/website-config.js';
export const lambdaHandler:LambdaHandler=async event=>{
 try{
  if(event.httpMethod==='GET'){websiteStripeConfiguration();return json(200,{enabled:true});}
  if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});
  if(event.headers.origin!==websiteStripeConfiguration().origin)throw new HttpError(403,'Invalid checkout origin.');
  if(!event.body||event.body.length>5000||event.isBase64Encoded)throw new HttpError(400,'Invalid checkout request.');
  let payload:unknown;try{payload=JSON.parse(event.body)}catch{throw new HttpError(400,'Invalid JSON request.');}
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new HttpError(400,'Invalid checkout request.');
  const {claimSecret,...selection}=payload as Record<string,unknown>;
  const parsed=websiteSessionSchema.safeParse(selection);if(!parsed.success||typeof claimSecret!=='string')throw new HttpError(400,'Invalid checkout selection.');
  const db=firestore();await consumeRateLimit({db,namespace:'api',subject:event.headers['x-nf-client-connection-ip']??'unknown',policy:{action:'website-checkout',limit:12,windowSeconds:600},now:new Date()});
  return json(201,await startWebsiteCheckout(new EntitlementStore(db),parsed.data,claimSecret,{
    ...(event.headers['x-nf-client-connection-ip']?{ipAddress:event.headers['x-nf-client-connection-ip']}:{}),
    ...(event.headers['user-agent']?{userAgent:event.headers['user-agent'].slice(0,1024)}:{})
  }));
 }catch(error){return errorResponse(error);}
};
export default withLambda(lambdaHandler);
