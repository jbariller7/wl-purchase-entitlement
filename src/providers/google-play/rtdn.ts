import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { googlePlayEnv } from "../../config/env.js";
import type { EntitlementStore } from "../../infrastructure/entitlement-store.js";
import { syncGooglePlayOneTimeProduct, syncGooglePlaySubscription } from "./service.js";
import { chapterMigrationTransactionId } from "../../domain/legacy-chapter-migration.js";

const pushSchema = z.object({
  message: z.object({
    data: z.string(),
    messageId: z.string(),
    publishTime: z.string().optional()
  }),
  subscription: z.string().optional()
});

const notificationSchema = z.object({
  version: z.string().optional(),
  packageName: z.string(),
  eventTimeMillis: z.string(),
  subscriptionNotification: z.object({
    version: z.string().optional(),
    notificationType: z.number(),
    purchaseToken: z.string(),
    subscriptionId: z.string()
  }).optional(),
  oneTimeProductNotification: z.object({
    version: z.string().optional(),
    notificationType: z.number(),
    purchaseToken: z.string(),
    sku: z.string()
  }).optional(),
  voidedPurchaseNotification: z.object({
    purchaseToken: z.string().optional(),
    orderId: z.string().optional(),
    productType: z.number().optional(),
    refundType: z.number().optional()
  }).optional(),
  testNotification: z.unknown().optional()
});

const oidc = new OAuth2Client();

export async function verifyPubSubAuthorization(authorization: string | undefined): Promise<void> {
  const configuration = googlePlayEnv();
  const audience = configuration.GOOGLE_PLAY_RTDN_AUDIENCE;
  const expectedEmail = configuration.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL;
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new Error("Missing Pub/Sub OIDC bearer token.");
  const ticket = await oidc.verifyIdToken({ idToken: match[1], audience });
  const payload = ticket.getPayload();
  if (!payload?.email_verified || payload.email !== expectedEmail) {
    throw new Error("Pub/Sub OIDC service account mismatch.");
  }
}

export function parseRtdn(body: unknown): {
  messageId: string;
  eventCreated: number;
  notification: z.infer<typeof notificationSchema>;
  raw: unknown;
} {
  const push = pushSchema.parse(body);
  const decoded = JSON.parse(Buffer.from(push.message.data, "base64").toString("utf8"));
  const notification = notificationSchema.parse(decoded);
  if (notification.packageName !== googlePlayEnv().GOOGLE_PLAY_PACKAGE_NAME) throw new Error("RTDN package name mismatch.");
  return {
    messageId: push.message.messageId,
    eventCreated: Math.floor(Number(notification.eventTimeMillis) / 1000),
    notification,
    raw: decoded
  };
}

export async function processRtdn(store: EntitlementStore, parsed: ReturnType<typeof parseRtdn>): Promise<void> {
  const subscription = parsed.notification.subscriptionNotification;
  if (subscription) {
    await syncGooglePlaySubscription({
      store,
      purchaseToken: subscription.purchaseToken,
      eventId: parsed.messageId,
      eventCreated: parsed.eventCreated
    });
    return;
  }
  const product = parsed.notification.oneTimeProductNotification;
  if (product) {
    await syncGooglePlayOneTimeProduct({
      store,
      productId: product.sku,
      purchaseToken: product.purchaseToken,
      eventId: parsed.messageId,
      eventCreated: parsed.eventCreated
    });
    return;
  }
  const voided = parsed.notification.voidedPurchaseNotification;
  if (voided?.orderId) {
    await Promise.all([
      store.revokeByProviderTransaction({
        provider: "google_play",
        providerTransactionId: voided.orderId,
        state: "refunded",
        sourceEvent: { id: parsed.messageId, created: parsed.eventCreated },
        at: new Date(parsed.eventCreated * 1000)
      }),
      store.revokeByProviderTransaction({
        provider: "google_play",
        providerTransactionId: chapterMigrationTransactionId(voided.orderId),
        state: "refunded",
        sourceEvent: { id: `${parsed.messageId}:chapter-full-upgrade`, created: parsed.eventCreated },
        at: new Date(parsed.eventCreated * 1000)
      })
    ]);
  }
}
