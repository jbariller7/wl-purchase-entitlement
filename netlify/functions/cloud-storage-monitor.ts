import { withLambda } from "@netlify/aws-lambda-compat";
import type { LambdaHandler } from "@netlify/aws-lambda-compat";
import { deploymentControls, env } from "../../src/config/env.js";

export const config = { schedule: "43 2 * * *" };

export const lambdaHandler: LambdaHandler = async () => {
  if (!deploymentControls().CLOUD_STORAGE_MONITORING_ENABLED) {
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "disabled", scanned: 0 })
    };
  }
  const [{ firestore, firebaseStorage }, monitor] = await Promise.all([
    import("../../src/infrastructure/firebase.js"),
    import("../../src/monitoring/cloud-storage-monitor.js")
  ]);
  const result = await monitor.runCloudStorageMonitor({
    source: new monitor.FirebaseStorageInventorySource(firebaseStorage()),
    repository: new monitor.FirestoreCloudStorageMetricsRepository(firestore()),
    dailyGrowthAlertBytes: env().CLOUD_STORAGE_DAILY_GROWTH_ALERT_BYTES
  });
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result)
  };
};

export default withLambda(lambdaHandler);
