import { withLambda, type LambdaHandler } from "@netlify/aws-lambda-compat";
import type { Config } from "@netlify/functions";
import { DiscountLinks } from "../../src/providers/stripe/discount-links.js";
import { firestore } from "../../src/infrastructure/firebase.js";
export const config: Config = { schedule: "* * * * *" };
export const lambdaHandler: LambdaHandler = async () => {
  const db=firestore(),now=new Date();
  const result=await new DiscountLinks(db).closeDueSessions(now);
  await db.collection("operationalMetrics").doc("discountLinkExpiry").set({...result,lastRunAt:now.toISOString()});
  return {statusCode:200,body:JSON.stringify(result)};
};
export default withLambda(lambdaHandler);
