import {withLambda,type LambdaHandler} from '@netlify/aws-lambda-compat';
import {firestore} from '../../src/infrastructure/firebase.js';
export const config={schedule:'41 8 * * *'};
export const lambdaHandler:LambdaHandler=async()=>{
 const db=firestore();let deleted=0;
 for(let page=0;page<4;page++){const old=await db.collection('steamClicks').where('expiresAt','<=',new Date()).limit(200).get();if(old.empty)break;const batch=db.batch();for(const d of old.docs)batch.delete(d.ref);await batch.commit();deleted+=old.size;}
 return {statusCode:200,body:JSON.stringify({deleted})};
};
export default withLambda(lambdaHandler);
