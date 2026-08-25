import { withLambda } from "@netlify/aws-lambda-compat";
import type { LambdaHandler } from "@netlify/aws-lambda-compat";
import { deploymentControls } from "../../src/config/env.js";
import { safeErrorMessage } from "../../src/infrastructure/safe-error.js";

export const lambdaHandler: LambdaHandler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  if (!deploymentControls().GOOGLE_PLAY_WEBHOOKS_ENABLED) {
    // Permit only Google's signed connectivity probe while processing is off.
    // Real purchase/refund notifications continue to fail closed and retry.
    if (!event.headers.authorization) return { statusCode: 503, body: "Google Play webhook processing is disabled" };
    const { parseRtdn, verifyPubSubAuthorization } = await import("../../src/providers/google-play/rtdn.js");
    try { await verifyPubSubAuthorization(event.headers.authorization); }
    catch (error) {
      console.warn("Rejected Google Play RTDN authorization", safeErrorMessage(error));
      return { statusCode: 401, body: "Unauthorized" };
    }
    try {
      const probe = parseRtdn(JSON.parse(event.body ?? "{}"));
      if (probe.notification.testNotification) return { statusCode: 204, body: "" };
    } catch (error) {
      console.warn("Rejected malformed Google Play RTDN", safeErrorMessage(error));
      return { statusCode: 400, body: "Malformed notification" };
    }
    return { statusCode: 503, body: "Google Play webhook processing is disabled" };
  }
  const [storeModule, firebaseModule, idsModule, rtdnModule] = await Promise.all([
    import("../../src/infrastructure/entitlement-store.js"),
    import("../../src/infrastructure/firebase.js"),
    import("../../src/infrastructure/ids.js"),
    import("../../src/providers/google-play/rtdn.js")
  ]);
  const { EntitlementStore } = storeModule;
  const { firestore } = firebaseModule;
  const { sha256 } = idsModule;
  const { parseRtdn, processRtdn, verifyPubSubAuthorization } = rtdnModule;
  try { await verifyPubSubAuthorization(event.headers.authorization); }
  catch (error) {
    console.warn("Rejected Google Play RTDN authorization", safeErrorMessage(error));
    return { statusCode: 401, body: "Unauthorized" };
  }
  let parsed;
  try { parsed = parseRtdn(JSON.parse(event.body ?? "{}")); }
  catch (error) {
    console.warn("Rejected malformed Google Play RTDN", safeErrorMessage(error));
    return { statusCode: 400, body: "Malformed notification" };
  }
  const store = new EntitlementStore(firestore());
  const decision = await store.beginProviderEvent({
    provider: "google_play",
    providerEventId: parsed.messageId,
    eventType: parsed.notification.subscriptionNotification
      ? "subscription"
      : parsed.notification.oneTimeProductNotification ? "one_time_product" : "other",
    eventCreated: parsed.eventCreated,
    payloadSha256: sha256(JSON.stringify(parsed.raw)),
    now: new Date()
  });
  if (decision === "duplicate") return { statusCode: 204, body: "" };
  try {
    await processRtdn(store, parsed);
    await store.completeProviderEvent("google_play", parsed.messageId, new Date());
    return { statusCode: 204, body: "" };
  } catch (error) {
    await store.failProviderEvent("google_play", parsed.messageId, error, new Date()).catch(() => undefined);
    console.error("Google Play RTDN processing failed", { messageId: parsed.messageId, error: safeErrorMessage(error) });
    return { statusCode: 500, body: "Retry" };
  }
};

export default withLambda(lambdaHandler);
