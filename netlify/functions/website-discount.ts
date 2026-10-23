import { withLambda, type LambdaHandler } from "@netlify/aws-lambda-compat";
import { DiscountLinks, assertDiscountAvailable, campaignOffers, discountForOffer } from "../../src/providers/stripe/discount-links.js";
import { firestore } from "../../src/infrastructure/firebase.js";
import { errorResponse, json } from "../../src/http/response.js";
import { publicDiscountHeaders } from "../../src/http/public-discount-cache.js";
function publicCampaign(link:Awaited<ReturnType<DiscountLinks["get"]>>) {
  const {id,name,offer,percentOff,locale,currency,delivery,learningLanguage,mobilePlatform,duration,durationMonths,expiresAt}=link;
  return {id,name,offer,percentOff,locale,currency,delivery,learningLanguage,mobilePlatform,duration,durationMonths,expiresAt};
}
export const lambdaHandler: LambdaHandler = async event => {
  try {
    if(event.httpMethod!=="GET") return {...json(405,{error:"Method not allowed"}),headers:{...json(405,{}).headers,'netlify-cdn-cache-control':'no-store','netlify-vary':'query=placement|id'}};
    if(event.queryStringParameters?.placement==="website") {
      const campaigns=(await new DiscountLinks(firestore()).saleCampaigns(new Date())).map(publicCampaign);
      return {...json(200,{campaigns}),headers:{...json(200,{}).headers,...publicDiscountHeaders(campaigns.map(c=>c.expiresAt))}};
    }
    const link=await new DiscountLinks(firestore()).get(event.queryStringParameters?.id??"");
    assertDiscountAvailable(link,new Date());
    return {...json(200,{...publicCampaign(link),...(campaignOffers(link).length>1?{variants:campaignOffers(link).map(offer=>publicCampaign(discountForOffer(link,offer)))}:{})}),headers:{...json(200,{}).headers,...publicDiscountHeaders([link.expiresAt])}};
  } catch(error) { const result=errorResponse(error); return {...result,headers:{...result.headers,'netlify-cdn-cache-control':'no-store','netlify-vary':'query=placement|id'}}; }
};
export default withLambda(lambdaHandler);
