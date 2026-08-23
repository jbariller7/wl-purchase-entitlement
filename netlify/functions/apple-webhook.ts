import type { Handler } from "@netlify/functions";
import { z } from "zod";
import { deploymentControls } from "../../src/config/env.js";

const bodySchema = z.object({ signedPayload: z.string().min(20) });

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  if (!deploymentControls().APPLE_WEBHOOKS_ENABLED) return { statusCode: 503, body: "Apple webhook processing is disabled" };
  const [storeModule, firebaseModule, idsModule, appleModule] = await Promise.all([
    import("../../src/infrastructure/entitlement-store.js"),
    import("../../src/infrastructure/firebase.js"),
    import("../../src/infrastructure/ids.js"),
    import("../../src/providers/apple/service.js")
  ]);
  const { EntitlementStore } = storeModule;
  const { firestore } = firebaseModule;
  const { sha256 } = idsModule;
  const { processAppleNotification, verifyAppleNotification } = appleModule;
  const parsedBody = bodySchema.safeParse(JSON.parse(event.body ?? "{}"));
  if (!parsedBody.success) return { statusCode: 400, body: "Malformed notification" };
  let verified;
  try { verified = await verifyAppleNotification(parsedBody.data.signedPayload); }
  catch (error) {
    console.warn("Rejected unverified Apple notification", error);
    return { statusCode: 401, body: "Verification failed" };
  }
  const eventId = verified.notification.notificationUUID;
  if (!eventId) return { statusCode: 400, body: "Missing notification UUID" };
  const eventCreated = Math.floor((verified.notification.signedDate ?? Date.now()) / 1000);
  const store = new EntitlementStore(firestore());
  const decision = await store.beginProviderEvent({
    provider: "apple",
    providerEventId: eventId,
    eventType: String(verified.notification.notificationType ?? "UNKNOWN"),
    eventCreated,
    payloadSha256: sha256(parsedBody.data.signedPayload),
    payload: {
      notificationType: verified.notification.notificationType,
      subtype: verified.notification.subtype,
      signedDate: verified.notification.signedDate,
      transactionId: verified.transaction?.transactionId,
      originalTransactionId: verified.transaction?.originalTransactionId,
      productId: verified.transaction?.productId
    },
    now: new Date()
  });
  if (decision === "duplicate") return { statusCode: 200, body: "Duplicate accepted" };
  try {
    await processAppleNotification({ store, verified });
    await store.completeProviderEvent("apple", eventId, new Date());
    return { statusCode: 200, body: "Processed" };
  } catch (error) {
    await store.failProviderEvent("apple", eventId, error, new Date()).catch(() => undefined);
    console.error("Apple notification processing failed", { eventId, error });
    return { statusCode: 500, body: "Retry" };
  }
};
