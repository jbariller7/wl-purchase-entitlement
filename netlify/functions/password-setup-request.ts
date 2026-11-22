import {withLambda,type LambdaHandler} from '@netlify/aws-lambda-compat';
import {z} from 'zod';
import {firebaseAuth,firestore} from '../../src/infrastructure/firebase.js';
import {PasswordRecoveryService} from '../../src/identity/password-recovery.js';
import {confirmationTransport} from '../../src/email/transport.js';
import copy from '../../catalog/password-setup-locales.json' with {type:'json'};
import {apiAllowedOrigins,requireAllowedOrigin,requestHeader} from '../../src/http/origin.js';
import {consumeRateLimit} from '../../src/http/rate-limit.js';
import {sha256} from '../../src/infrastructure/ids.js';
import {HttpError} from '../../src/http/auth.js';
import {errorResponse,json,parseJsonBody} from '../../src/http/response.js';
export const config={rateLimit:{windowSize:60,windowLimit:5,aggregateBy:['domain','ip']}};
const schema=z.object({email:z.string().trim().email().max(254),locale:z.string().max(10).default('en')}).strict();
export const lambdaHandler:LambdaHandler=async event=>{
 try{
  if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed'});
  requireAllowedOrigin(requestHeader(event.headers,'origin'),apiAllowedOrigins(false));
  const input=schema.parse(parseJsonBody(event.body));input.email=input.email.toLowerCase();
  const db=firestore(),now=new Date();
  for(const [subject,limit] of [[requestHeader(event.headers,'x-nf-client-connection-ip')||'unknown',10],[input.email,3]] as const){
   await consumeRateLimit({db,namespace:'api',subject:sha256(subject),policy:{action:'password-setup-email',limit,windowSeconds:3600},now});
  }
  const transport=confirmationTransport();
  let result;
  try{result=await new PasswordRecoveryService(db,firebaseAuth()).issue({email:input.email,actor:{uid:'password-setup-service',email:input.email},reason:'Customer requested a link sent to the account mailbox',selfService:true,now});}
  catch(error){if(error instanceof HttpError&&error.status===409)return json(200,{ok:true});throw error;}
  const words=copy[input.locale as keyof typeof copy]||copy.en;
  const sent=await transport.sendMail({from:{name:'WonderLang',address:'orders@wonderlang.app'},replyTo:'support@wonderlang.app',to:input.email,
   subject:'WonderLang — '+words[0],text:words[1]+'\n\n'+result.link+'\n\nsupport@wonderlang.app'});
  if(!sent.accepted?.length)throw new Error('Password setup email delivery was not accepted');
  return json(200,{ok:true});
 }catch(error){return errorResponse(error);}
};
export default withLambda(lambdaHandler);
