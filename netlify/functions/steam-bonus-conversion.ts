import {withLambda,type LambdaHandler} from '@netlify/aws-lambda-compat';
import {z} from 'zod';
import {firestore} from '../../src/infrastructure/firebase.js';
import {deploymentControls} from '../../src/config/env.js';
import {recordSteamBonus} from '../../src/ads/steam-bonus.js';
import {consumeRateLimit} from '../../src/http/rate-limit.js';
import {json,errorResponse,parseJsonBody} from '../../src/http/response.js';
import {HttpError} from '../../src/http/auth.js';
const schema=z.object({emailSha256:z.string().regex(/^[a-f0-9]{64}$/),
  fbp:z.string().regex(/^fb\.\d+\.\d+\.[\w.-]+$/).max(255).optional(),
  fbc:z.string().regex(/^fb\.\d+\.\d+\.[\w.-]+$/).max(255).optional()}).strict();
export const lambdaHandler:LambdaHandler=async event=>{
 const origin=event.headers.origin??'';
 const allowed=origin==='null'||/^chrome-extension:\/\/[a-z]{32}$/.test(origin)||
   ['https://wonderlang.app','https://wl-purchase-entitlement.netlify.app'].includes(origin);
 const cors=allowed?{'access-control-allow-origin':origin,'vary':'Origin'}:{};
 const reply=(r:ReturnType<typeof json>)=>({...r,headers:{...r.headers,...cors}});
 try{
  if(!allowed)throw new HttpError(403,'Invalid origin.');
  if(event.httpMethod==='OPTIONS')return reply({...json(200,{}),headers:{'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'content-type'}});
  if(event.httpMethod!=='POST')return reply(json(405,{error:'Method not allowed'}));
  if(!deploymentControls().AD_CONVERSIONS_ENABLED)throw new HttpError(503,'Reporting temporarily unavailable.');
  if(!event.body||event.body.length>1500||event.isBase64Encoded)throw new HttpError(400,'Invalid request.');
  const parsed=schema.safeParse(parseJsonBody(event.body));
  if(!parsed.success)throw new HttpError(400,'Invalid request.');
  const db=firestore(),now=new Date(),ip=event.headers['x-nf-client-connection-ip'];
  await consumeRateLimit({db,namespace:'api',subject:ip??'unknown',policy:{action:'steam-bonus-conversion',limit:12,windowSeconds:3600},now});
  return reply(json(200,await recordSteamBonus(db,{emailSha256:parsed.data.emailSha256,
    ...(parsed.data.fbp?{fbp:parsed.data.fbp}:{}),...(parsed.data.fbc?{fbc:parsed.data.fbc}:{}),
    ...(ip?{ipAddress:ip}:{}),...(event.headers['user-agent']?{userAgent:event.headers['user-agent'].slice(0,1024)}:{})},now)));
 }catch(error){return reply(errorResponse(error));}
};
export default withLambda(lambdaHandler);
