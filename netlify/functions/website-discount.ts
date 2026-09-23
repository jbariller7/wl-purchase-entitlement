import { withLambda, type LambdaHandler } from "@netlify/aws-lambda-compat";
import { DiscountLinks, assertDiscountAvailable } from "../../src/providers/stripe/discount-links.js";
import { firestore } from "../../src/infrastructure/firebase.js";
import { errorResponse, json } from "../../src/http/response.js";
export const lambdaHandler: LambdaHandler = async event => {
  try {
    if(event.httpMethod!=="GET") return json(405,{error:"Method not allowed"});
    const link=await new DiscountLinks(firestore()).get(event.queryStringParameters?.id??"");
    assertDiscountAvailable(link,new Date());
    const {id,name,offer,percentOff,locale,currency,delivery,learningLanguage,mobilePlatform,duration,durationMonths,expiresAt}=link;
    return json(200,{id,name,offer,percentOff,locale,currency,delivery,learningLanguage,mobilePlatform,duration,durationMonths,expiresAt});
  } catch(error) { return errorResponse(error); }
};
export default withLambda(lambdaHandler);
