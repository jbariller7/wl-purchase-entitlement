import {withLambda,type LambdaHandler} from '@netlify/aws-lambda-compat';
import {firestore} from '../../src/infrastructure/firebase.js';
import {deliverContact} from '../../src/contact/service.js';
export const config={schedule:'* * * * *'};
export const lambdaHandler:LambdaHandler=async()=>{
 const db=firestore(),due=await db.collection('contactMessages').where('nextAttemptAt','<=',new Date().toISOString()).orderBy('nextAttemptAt').limit(5).get();
 const results=await Promise.allSettled(due.docs.map(d=>deliverContact(db,d.id)));
 return {statusCode:200,body:JSON.stringify({checked:results.length,sent:results.filter(r=>r.status==='fulfilled'&&r.value).length})};
};
export default withLambda(lambdaHandler);
