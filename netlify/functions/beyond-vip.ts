import {withLambda,type LambdaHandler} from '@netlify/aws-lambda-compat';
import type {Config} from '@netlify/functions';
import {firestore} from '../../src/infrastructure/firebase.js';
import {websiteStripeClient,websiteStripeConfiguration} from '../../src/providers/stripe/website-config.js';
import {createVipCheckout,vipStatus} from '../../src/beyond-vip/service.js';
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
  if(status)return {statusCode:200,headers:{...headers,'content-type':'application/json'},body:JSON.stringify(await vipStatus(db,stripe,q.session_id??'',q.token??''))};
  const url=await createVipCheckout(db,stripe,q.tier!,websiteStripeConfiguration().origin);
  return {statusCode:303,headers:{...headers,location:url},body:''};
 }catch(error){
  const code=error instanceof HttpError?error.status:503;
  if(code===503)console.error('Beyond VIP checkout unavailable',safeErrorMessage(error));
  const message=code===429?'Too many checkout requests. Please try again in ten minutes.':code===400?'Please choose one of the available VIP rewards.':'VIP checkout is temporarily unavailable. Please try again or email jonathan@wonderlang.app.';
  return status?{statusCode:code,headers:{...headers,'content-type':'application/json'},body:JSON.stringify({error:code===404?'Reservation not found.':message})}:
   {statusCode:code,headers:{...headers,'content-type':'text/html; charset=utf-8'},body:`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VIP reservation | WonderLang Beyond</title><link rel="stylesheet" href="/beyondmockup/campaign.css"><main class="reservation-page"><img class="reservation-beanie" src="/beyondmockup/assets/beanie.png" alt="Ben" width="80" height="80"><h1>Let’s try that again.</h1><p>${message}</p><p>This page has not confirmed a payment. If you already paid, please keep your receipt and contact us before trying again.</p><a href="/beyondmockup/#rewards">Back to the VIP rewards →</a></main></html>`};
 }
};
export default withLambda(lambdaHandler);
