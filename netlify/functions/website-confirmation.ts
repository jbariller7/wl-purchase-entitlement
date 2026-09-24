import {withLambda,type LambdaHandler} from '@netlify/aws-lambda-compat';
import {createHash,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {websiteStripeClient,websiteStripeConfiguration} from '../../src/providers/stripe/website-config.js';
import {websiteSessionSchema} from '../../src/providers/stripe/website-session.js';
import {websiteDesktopRoute} from '../../src/providers/stripe/website-commerce.js';
import {websiteDelivery} from '../../src/legacy/website-delivery.js';
import {renderConfirmation} from '../../src/email/template.js';
import {firestore} from '../../src/infrastructure/firebase.js';
import {consumeRateLimit} from '../../src/http/rate-limit.js';
import {HttpError} from '../../src/http/auth.js';
import {json,errorResponse,parseJsonBody} from '../../src/http/response.js';
const schema=z.object({sessionId:z.string().regex(/^cs_live_[A-Za-z0-9]+$/),claimSecret:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict();
export const lambdaHandler:LambdaHandler=async event=>{
 try{
  if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});
  const origin=websiteStripeConfiguration().origin;
  if(event.headers.origin!==origin && !(origin==='https://wonderlang.app'&&event.headers.origin==='https://wl-purchase-entitlement.netlify.app'))throw new HttpError(403,'Invalid origin.');
  if(!event.body||event.body.length>1000||event.isBase64Encoded)throw new HttpError(400,'Invalid request.');
  const parsed=schema.safeParse(parseJsonBody(event.body));if(!parsed.success)throw new HttpError(400,'Invalid request.');
  const input=parsed.data,db=firestore();
  await consumeRateLimit({db,namespace:'api',subject:event.headers['x-nf-client-connection-ip']??'unknown',policy:{action:'website-confirmation',limit:20,windowSeconds:600},now:new Date()});
  const session=await websiteStripeClient().checkout.sessions.retrieve(input.sessionId,{expand:['payment_intent.latest_charge']});
  const requestId=session.metadata?.wl_request_id;
  if(!session.livemode||session.metadata?.wl_checkout_flow!=='website-session-v1'||!requestId)throw new HttpError(404,'Purchase not found.');
  const quote=(await db.collection('websiteCheckoutRequests').doc(requestId).get()).data();
  const supplied=createHash('sha256').update(input.claimSecret).digest(),expected=Buffer.from(typeof quote?.claimHash==='string'?quote.claimHash:'','hex');
  if(quote?.sessionId!==session.id||expected.length!==supplied.length||!timingSafeEqual(expected,supplied))throw new HttpError(404,'Purchase not found.');
  if(session.status!=='complete'||!['paid','no_payment_required'].includes(session.payment_status))throw new HttpError(409,'Payment confirmation is pending.');
  const pi=typeof session.payment_intent==='object'?session.payment_intent:null;
  const charge=pi&&typeof pi.latest_charge==='object'?pi.latest_charge:null;
  if(charge&&(charge.refunded||charge.disputed))throw new HttpError(403,'This payment is refunded or disputed.');
  const request=websiteSessionSchema.parse(quote.request),email=session.customer_details?.email?.trim().toLowerCase();
  if(!email||!session.currency)throw new HttpError(409,'Order details are not ready.');
  const route=websiteDesktopRoute(request);
  let keys:string[]=[];
  // A delayed key allocator must not hide the verified order and access instructions.
  if(route)try{keys=(await websiteDelivery(db,session.id,email,route.sheetTab)).map(k=>k.key);}catch{ /* Show pending delivery; email worker retries independently. */ }
  const result=renderConfirmation({request,email,reference:session.id,amount:session.amount_total??0,currency:session.currency,country:session.customer_details?.address?.country,keys},'web');
  return json(200,{locale:result.locale,title:result.subject,contentHtml:result.contentHtml,deliveryPending:!!route&&!keys.length});
 }catch(error){return errorResponse(error);}
};
export default withLambda(lambdaHandler);
