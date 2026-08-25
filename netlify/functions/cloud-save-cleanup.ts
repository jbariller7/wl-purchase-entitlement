import { withLambda } from "@netlify/aws-lambda-compat";
import type { Config } from "@netlify/functions";
import type { LambdaHandler } from "@netlify/aws-lambda-compat";
import { deploymentControls } from "../../src/config/env.js";

export const config: Config = { schedule: "23 * * * *" };

export const lambdaHandler: LambdaHandler = async () => {
  if (!deploymentControls().CLOUD_SAVE_CLEANUP_ENABLED) {
    return { statusCode: 200, body: JSON.stringify({ state: "disabled", scanned: 0, deleted: 0, failed: 0, skipped: 0 }) };
  }
  const [{ firestore, firebaseStorage }, cleanup] = await Promise.all([
    import("../../src/infrastructure/firebase.js"),
    import("../../src/cloud-save/cleanup-service.js")
  ]);
  const db = firestore();
  const now = new Date();
  const metric = db.collection("operationalMetrics").doc("cloudSaveCleanup");
  try {
    const result = await new cleanup.CloudSaveCleanupService(db, firebaseStorage()).run(now);
    await metric.set({
      state: "succeeded",
      lastRunAt: now.toISOString(),
      lastError: null,
      ...result
    }, { merge: true });
    return { statusCode: 200, body: JSON.stringify({ state: "complete", ...result }) };
  } catch {
    await metric.set({
      state: "failed",
      lastRunAt: now.toISOString(),
      lastError: "Cloud-save cleanup worker failed."
    }, { merge: true }).catch(() => undefined);
    console.error("Cloud-save cleanup worker failed", { error: "Cloud-save cleanup worker failed." });
    throw new Error("Cloud-save cleanup worker failed.");
  }
};

export default withLambda(lambdaHandler);
