import {withLambda,type LambdaHandler} from '@netlify/aws-lambda-compat';
import {z} from 'zod';
import {verifyAllocationSignature,allocateSheetKey} from '../../src/legacy/sheet-allocation.js';
import {firestore} from '../../src/infrastructure/firebase.js';
const schema=z.object({sheetTab:z.string().max(50),email:z.string().trim().email().max(254),sessionId:z.string().regex(/^cs_live_[A-Za-z0-9_]+$/),paymentLinkId:z.string().max(255).optional()}).strict();
export const lambdaHandler:LambdaHandler=async event=>{
 if(event.httpMethod!=='POST')return {statusCode:405,body:'Method not allowed'};
 const raw=event.isBase64Encoded?Buffer.from(event.body??'','base64').toString('utf8'):event.body??'';
 const secret=process.env.STRIPE_WEBSITE_WEBHOOK_SECRET;
 if(!secret||!verifyAllocationSignature(raw,event.headers['x-wl-time']??'',event.headers['x-wl-signature']??'',secret))return {statusCode:401,body:'Unauthorized'};
 let data;try{data=schema.parse(JSON.parse(raw));}catch{return {statusCode:400,body:'Invalid allocation request'};}
 try{const result=await allocateSheetKey(firestore(),{orderId:data.sessionId,email:data.email,sheetTab:data.sheetTab,...(data.paymentLinkId?{paymentLinkId:data.paymentLinkId}:{})});return {statusCode:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:JSON.stringify(result)};}
 catch{return {statusCode:503,body:'Key delivery needs retry or inventory review'};}
};
export default withLambda(lambdaHandler);
