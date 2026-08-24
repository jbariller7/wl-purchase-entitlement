import { withLambda } from "@netlify/aws-lambda-compat";
import type { Config } from "@netlify/functions";
import type { LambdaHandler } from "@netlify/aws-lambda-compat";
import { deploymentControls } from "../../src/config/env.js";
import { deleteExpiredDeviceSignInSessions } from "../../src/device-sign-in/service.js";
import { firestore } from "../../src/infrastructure/firebase.js";

export const config: Config = { schedule: "7 * * * *" };

export const lambdaHandler: LambdaHandler = async () => {
  if (!deploymentControls().DEVICE_SIGN_IN_CLEANUP_ENABLED) {
    return { statusCode: 200, body: JSON.stringify({ state: "disabled", deleted: 0 }) };
  }
  const deleted = await deleteExpiredDeviceSignInSessions(firestore(), new Date());
  return { statusCode: 200, body: JSON.stringify({ state: "complete", deleted }) };
};

export default withLambda(lambdaHandler);
