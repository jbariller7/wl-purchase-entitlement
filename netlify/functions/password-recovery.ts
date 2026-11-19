import {withLambda} from "@netlify/aws-lambda-compat";
import type {LambdaHandler} from "@netlify/aws-lambda-compat";
import {z} from "zod";
import {firebaseAuth, firestore} from "../../src/infrastructure/firebase.js";
import {PasswordRecoveryService} from "../../src/identity/password-recovery.js";
import {apiAllowedOrigins, requireAllowedOrigin, requestHeader} from "../../src/http/origin.js";
import {consumeRateLimit} from "../../src/http/rate-limit.js";
import {sha256} from "../../src/infrastructure/ids.js";
import {errorResponse, json, parseJsonBody} from "../../src/http/response.js";
export const config = {rateLimit:{windowSize:60,windowLimit:10,aggregateBy:["domain","ip"]}};
const schema = z.object({
  uid:z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  token:z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  password:z.string().min(12).max(128)
}).strict();
export const lambdaHandler: LambdaHandler = async event => {
  try {
    if (event.httpMethod !== "POST") return json(405,{error:"Method not allowed"});
    requireAllowedOrigin(requestHeader(event.headers,"origin"),apiAllowedOrigins(false));
    const parsed=schema.safeParse(parseJsonBody(event.body));
    if (!parsed.success) return json(400,{error:"Invalid recovery request"});
    const db=firestore(), now=new Date();
    await consumeRateLimit({db,namespace:"api",
      subject:sha256(requestHeader(event.headers,"x-nf-client-connection-ip") || "unknown"),
      policy:{action:"password-recovery-consume",limit:10,windowSeconds:600},now});
    return json(200,await new PasswordRecoveryService(db,firebaseAuth()).consume({...parsed.data,now}));
  } catch(error) {return errorResponse(error);}
};
export default withLambda(lambdaHandler);
