import {withLambda,type LambdaHandler} from '@netlify/aws-lambda-compat';
import type {Config} from '@netlify/functions';
import {firestore} from '../../src/infrastructure/firebase.js';
import {websiteStripeClient,websiteStripeConfiguration} from '../../src/providers/stripe/website-config.js';
import {createVipCheckout,vipStatus} from '../../src/beyond-vip/service.js';
import {vipAttribution} from '../../src/beyond-vip/attribution.js';
import {vipTier} from '../../src/beyond-vip/catalog.js';
import {consumeRateLimit} from '../../src/http/rate-limit.js';
import {HttpError} from '../../src/http/auth.js';
import {safeErrorMessage} from '../../src/infrastructure/safe-error.js';
export const config:Config={rateLimit:{windowSize:60,windowLimit:30,aggregateBy:['domain','ip']}};
export const lambdaHandler:LambdaHandler=async event=>{
 const headers={'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'};
 const status=event.queryStringParameters?.action==='status';
 if(event.httpMethod!=='GET')return {statusCode:405,headers,body:'Method not allowed'};
 try{
  const q=event.queryStringParameters??{};
  if(!status&&!vipTier(q.tier))throw new HttpError(400,'Choose an available VIP reward.');
  const db=firestore();
  await consumeRateLimit({db,namespace:'api',subject:event.headers['x-nf-client-connection-ip']??'unknown',policy:{action:status?'vip-status':'vip-checkout',limit:status?60:15,windowSeconds:600},now:new Date()});
  const stripe=websiteStripeClient();
  if(status)return {statusCode:200,headers:{...headers,'content-type':'application/json'},body:JSON.stringify(await vipStatus(db,stripe,q.session_id??'',q.token??'',vipAttribution(q,event.headers).metaOptOut==='1'))};
  const url=await createVipCheckout(db,stripe,q.tier!,websiteStripeConfiguration().origin,vipAttribution(q,event.headers));
  return {statusCode:303,headers:{...headers,location:url},body:''};
 }catch(error){
  const code=error instanceof HttpError?error.status:503;
  if(code===503)console.error('Beyond VIP checkout unavailable',safeErrorMessage(error));
  const message=code===429?'Too many checkout requests. Please try again in ten minutes.':code===400?'Please choose one of the available VIP rewards.':'VIP checkout is temporarily unavailable. Please try again or email jonathan@wonderlang.app.';
  return status?{statusCode:code,headers:{...headers,'content-type':'application/json'},body:JSON.stringify({error:code===404?'Reservation not found.':message})}:
   {statusCode:303,headers:{...headers,location:'/beyondmockup/checkout-error.html?code='+code},body:''};
 }
};
export default withLambda(lambdaHandler);
