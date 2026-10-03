import {withLambda,type LambdaHandler} from '@netlify/aws-lambda-compat';
import {contactSchema,saveContact} from '../../src/contact/service.js';
import {firestore} from '../../src/infrastructure/firebase.js';
import {consumeRateLimit} from '../../src/http/rate-limit.js';
import {requestHeader} from '../../src/http/origin.js';
import {json,errorResponse,parseJsonBody} from '../../src/http/response.js';
import {HttpError} from '../../src/http/auth.js';
export const config={rateLimit:{windowSize:60,windowLimit:10,aggregateBy:['domain','ip']}};
export const lambdaHandler:LambdaHandler=async event=>{
 try{
  if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});
  const origin=requestHeader(event.headers,'origin');
  if(!['https://wonderlang.app','https://www.wonderlang.app','https://wl-purchase-entitlement.netlify.app'].includes(origin??''))throw new HttpError(403,'Origin not allowed');
  if(!requestHeader(event.headers,'content-type')?.startsWith('application/json')||event.isBase64Encoded||(event.body?.length??0)>14000)throw new HttpError(400,'Invalid message');
  const parsed=contactSchema.safeParse(parseJsonBody(event.body));if(!parsed.success)throw new HttpError(400,'Please check the form fields');
  const db=firestore(),now=new Date();
  // Netlify supplies this header. Do not trust user-controlled forwarded-for.
  const ip=requestHeader(event.headers,'x-nf-client-connection-ip');if(!ip)throw new HttpError(503,'Request protection unavailable');
  for(const [subject,action,limit,windowSeconds]of [[ip,'contact-ip',5,3600],[parsed.data.email,'contact-email',5,86400],['global','contact-global',100,3600]]as const)
   await consumeRateLimit({db,namespace:'api',subject,policy:{action,limit,windowSeconds},now});
  return json(202,await saveContact(db,parsed.data));
 }catch(error){return errorResponse(error)}
};
export default withLambda(lambdaHandler);
