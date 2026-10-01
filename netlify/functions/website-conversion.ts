import {withLambda,type LambdaHandler} from '@netlify/aws-lambda-compat';
import {createHash,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {websiteStripeClient,websiteStripeConfiguration} from '../../src/providers/stripe/website-config.js';
import {firestore} from '../../src/infrastructure/firebase.js';
import {consumeRateLimit} from '../../src/http/rate-limit.js';
import {HttpError} from '../../src/http/auth.js';
import {json,errorResponse,parseJsonBody} from '../../src/http/response.js';
import {stripeMajorValue} from '../../src/domain/regional-pricing.js';
const schema=z.object({sessionId:z.string().regex(/^cs_live_[A-Za-z0-9]+$/),claimSecret:z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),conversionToken:z.string().regex(/^[a-f0-9]{64}$/).optional(),pixelStatus:z.enum(['handed_off','unavailable']).optional()}).strict().refine(x=>Boolean(x.claimSecret)!==Boolean(x.conversionToken));
export const lambdaHandler:LambdaHandler=async event=>{
 try{
  if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});
  const canonicalOrigin=websiteStripeConfiguration().origin;
  // Pending Stripe sessions can still return to the original browser origin.
  const legacyReturn=canonicalOrigin==='https://wonderlang.app'&&event.headers.origin==='https://wl-purchase-entitlement.netlify.app';
  if(event.headers.origin!==canonicalOrigin&&!legacyReturn)throw new HttpError(403,'Invalid origin.');
  if(!event.body||event.body.length>1000||event.isBase64Encoded)throw new HttpError(400,'Invalid request.');
  const parsed=schema.safeParse(parseJsonBody(event.body));if(!parsed.success)throw new HttpError(400,'Invalid request.');const input=parsed.data;
  const db=firestore();
  await consumeRateLimit({db,namespace:'api',subject:event.headers['x-nf-client-connection-ip']??'unknown',policy:{action:'website-conversion',limit:20,windowSeconds:600},now:new Date()});
  const session=await websiteStripeClient().checkout.sessions.retrieve(input.sessionId);
  const requestId=session.metadata?.wl_request_id;
  if(!session.livemode||session.metadata?.wl_checkout_flow!=='website-session-v1'||!requestId)throw new HttpError(404,'Purchase not found.');
  const quoteRef=db.collection('websiteCheckoutRequests').doc(requestId);
  const quote=(await quoteRef.get()).data();
  const supplied=createHash('sha256').update(input.conversionToken??input.claimSecret!).digest();
  const expectedHash=input.conversionToken?quote?.conversionTokenHash:quote?.claimHash;
  const expected=Buffer.from(typeof expectedHash==='string'?expectedHash:'','hex');
  if(quote?.sessionId!==session.id||expected.length!==supplied.length||!timingSafeEqual(expected,supplied))throw new HttpError(404,'Purchase not found.');
  if(session.status!=='complete'||session.payment_status!=='paid'||!session.currency||!session.amount_total)return json(200,{conversion:null});
  // Operational evidence only: a pixel handoff is explicitly not a Meta ACK.
  await quoteRef.set({browserConversionVerifiedAt:new Date().toISOString(),...(input.pixelStatus?{
    browserPixelStatus:input.pixelStatus,browserPixelStatusAt:new Date().toISOString()
  }:{})},{merge:true}).catch(()=>{});
  const pixel=process.env.META_PIXEL_ID;
  // An old bookmarked completion page must not create another browser event
  // after the platform's deduplication window. Server payment reporting remains.
  const age=Date.now()/1000-session.created;
  const meta=quote?.request?.attribution?.metaOptOut!=='1'&&session.mode==='payment'&&session.metadata?.wl_ads_owner==='entitlement-v2'&&
    Number.isFinite(age)&&age>=0&&age<86400&&
    process.env.AD_CONVERSIONS_ENABLED==='true'&&/^\d+$/.test(pixel??'') ? {
      pixelId:pixel,eventId:session.id,eventName:'Purchase',product:session.metadata.wl_website_offer??'wonderlang',
      ...Object.fromEntries(['fbp','fbc'].flatMap(key=>typeof quote?.request?.attribution?.[key]==='string'?[[key,quote.request.attribution[key]]]:[])),
      ...(session.customer_details?.email?{emailSha256:createHash('sha256').update(session.customer_details.email.trim().toLowerCase()).digest('hex')}:{})
    }:undefined;
  return json(200,{conversion:{transactionId:session.id,value:stripeMajorValue(session.currency,session.amount_total),currency:session.currency.toUpperCase(),...(meta?{meta}:{})}});
 }catch(error){return errorResponse(error);}
};
export default withLambda(lambdaHandler);
