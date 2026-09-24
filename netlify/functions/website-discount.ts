import { withLambda, type LambdaHandler } from "@netlify/aws-lambda-compat";
import { DiscountLinks, assertDiscountAvailable } from "../../src/providers/stripe/discount-links.js";
import { firestore } from "../../src/infrastructure/firebase.js";
import { errorResponse, json } from "../../src/http/response.js";
function publicCampaign(link:Awaited<ReturnType<DiscountLinks["get"]>>) {
  const {id,name,offer,percentOff,locale,currency,delivery,learningLanguage,mobilePlatform,duration,durationMonths,expiresAt}=link;
  return {id,name,offer,percentOff,locale,currency,delivery,learningLanguage,mobilePlatform,duration,durationMonths,expiresAt};
}
export const lambdaHandler: LambdaHandler = async event => {
  try {
    if(event.httpMethod!=="GET") return json(405,{error:"Method not allowed"});
    if(event.queryStringParameters?.placement==="website") return json(200,{campaigns:(await new DiscountLinks(firestore()).saleCampaigns(new Date())).map(publicCampaign)});
    const link=await new DiscountLinks(firestore()).get(event.queryStringParameters?.id??"");
    assertDiscountAvailable(link,new Date());
    return json(200,publicCampaign(link));
  } catch(error) { return errorResponse(error); }
};
export default withLambda(lambdaHandler);
