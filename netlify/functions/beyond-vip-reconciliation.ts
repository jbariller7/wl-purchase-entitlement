import {withLambda,type LambdaHandler} from '@netlify/aws-lambda-compat';
import {firestore} from '../../src/infrastructure/firebase.js';
import {websiteStripeClient} from '../../src/providers/stripe/website-config.js';
import {reconcileVipReservations} from '../../src/beyond-vip/service.js';
export const lambdaHandler:LambdaHandler=async()=>{
 const result=await reconcileVipReservations(firestore(),websiteStripeClient());
 console.log('Beyond VIP reconciliation',result);
 return {statusCode:200,body:JSON.stringify(result)};
};
export default withLambda(lambdaHandler);
