import { withLambda } from "@netlify/aws-lambda-compat";
import type { LambdaHandler } from "@netlify/aws-lambda-compat";
import { deploymentControls } from "../../src/config/env.js";

export const config = { schedule: "17 * * * *" };

export const lambdaHandler: LambdaHandler = async () => {
  if (!deploymentControls().SUBSCRIPTION_RECONCILIATION_ENABLED) {
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "disabled", attempted: 0, succeeded: 0, failed: 0 })
    };
  }
  const [{ firestore }, { EntitlementStore }, { runSubscriptionReconciliation }] = await Promise.all([
    import("../../src/infrastructure/firebase.js"),
    import("../../src/infrastructure/entitlement-store.js"),
    import("../../src/reconciliation/subscription-reconciler.js")
  ]);
  const db = firestore();
  const result = await runSubscriptionReconciliation({ db, store: new EntitlementStore(db) });
  return {
    statusCode: result.failed ? 207 : 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result)
  };
};

export default withLambda(lambdaHandler);
