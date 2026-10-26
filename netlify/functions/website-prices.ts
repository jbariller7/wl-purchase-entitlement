import {withLambda,type LambdaHandler} from '@netlify/aws-lambda-compat';
import {firestore} from '../../src/infrastructure/firebase.js';
import {WebsiteCatalogService} from '../../src/catalog/website-service.js';
import {json,errorResponse} from '../../src/http/response.js';
export const lambdaHandler:LambdaHandler=async event=>{
 try{
  if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed'});
  const {revision,prices}=await new WebsiteCatalogService(firestore()).get();
  return {...json(200,{revision,prices}),headers:{...json(200,{}).headers,'cache-control':'no-store','netlify-cdn-cache-control':'no-store'}};
 }catch(error){return errorResponse(error);}
};
export default withLambda(lambdaHandler);
