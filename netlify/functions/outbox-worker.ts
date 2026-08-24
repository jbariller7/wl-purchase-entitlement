import { withLambda } from "@netlify/aws-lambda-compat";
import type { LambdaHandler } from "@netlify/aws-lambda-compat";
import { deploymentControls } from "../../src/config/env.js";

export const config = { schedule: "* * * * *" };

export const lambdaHandler: LambdaHandler = async () => {
  if (!deploymentControls().OUTBOX_PROCESSING_ENABLED) {
    return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ processed: 0, failed: 0 }) };
  }
  const { runOutboxWorker } = await import("../../src/outbox/worker.js");
  const result = await runOutboxWorker();
  return {
    statusCode: result.failed ? 207 : 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result)
  };
};

export default withLambda(lambdaHandler);
