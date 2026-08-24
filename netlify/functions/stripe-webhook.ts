import { withLambda } from "@netlify/aws-lambda-compat";
import type { LambdaHandler } from "@netlify/aws-lambda-compat";
import { deploymentControls, env } from "../../src/config/env.js";

export const handler: LambdaHandler = async (request) => {
  if (request.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  if (!deploymentControls().STRIPE_WEBHOOKS_ENABLED) return { statusCode: 503, body: "Stripe webhook processing is disabled" };
  const [storeModule, firebaseModule, idsModule, stripeModule, processorModule] = await Promise.all([
    import("../../src/infrastructure/entitlement-store.js"),
    import("../../src/infrastructure/firebase.js"),
    import("../../src/infrastructure/ids.js"),
    import("../../src/providers/stripe/client.js"),
    import("../../src/providers/stripe/event-processor.js")
  ]);
  const { EntitlementStore } = storeModule;
  const { firestore } = firebaseModule;
  const { sha256 } = idsModule;
  const { stripeClient } = stripeModule;
  const { processStripeEvent } = processorModule;
  const signature = request.headers["stripe-signature"];
  if (!signature || !request.body) return { statusCode: 400, body: "Missing Stripe signature or body" };
  const rawBody = request.isBase64Encoded
    ? Buffer.from(request.body, "base64").toString("utf8")
    : request.body;
  let event;
  try {
    event = stripeClient().webhooks.constructEvent(rawBody, signature, env().STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.warn("Rejected Stripe webhook signature", error instanceof Error ? error.message : error);
    return { statusCode: 400, body: "Invalid signature" };
  }

  const store = new EntitlementStore(firestore());
  const now = new Date();
  const decision = await store.beginProviderEvent({
    provider: "stripe",
    providerEventId: event.id,
    eventType: event.type,
    eventCreated: event.created,
    payloadSha256: sha256(rawBody),
    payload: event,
    now
  });
  if (decision === "duplicate") return { statusCode: 200, body: "Duplicate accepted" };
  try {
    await processStripeEvent(store, event);
    await store.completeProviderEvent("stripe", event.id, new Date());
    return { statusCode: 200, body: "Processed" };
  } catch (error) {
    await store.failProviderEvent("stripe", event.id, error, new Date()).catch(() => undefined);
    console.error("Stripe webhook processing failed", { eventId: event.id, type: event.type, error });
    return { statusCode: 500, body: "Processing failed; Stripe should retry" };
  }
};

export default withLambda(handler);
