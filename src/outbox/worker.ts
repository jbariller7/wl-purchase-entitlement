import { randomUUID } from "node:crypto";
import type { OutboxJob, LegacyOrder } from "../domain/model.js";
import { sendMetaConversion, sendTikTokConversion } from "../ads/conversion-senders.js";
import { EntitlementStore } from "../infrastructure/entitlement-store.js";
import { firestore } from "../infrastructure/firebase.js";
import { LegacyKeyFulfillmentService } from "../legacy/key-fulfillment.js";
import { stripeClient } from "../providers/stripe/client.js";
import { deploymentControls } from "../config/env.js";

async function execute(job: OutboxJob, store: EntitlementStore): Promise<Record<string, unknown> | undefined> {
  switch (job.kind) {
    case "meta_conversion":
      if (!deploymentControls().AD_CONVERSIONS_ENABLED) throw new Error("Ad conversion delivery is disabled.");
      await sendMetaConversion(job.payload);
      return;
    case "tiktok_conversion":
      if (!deploymentControls().AD_CONVERSIONS_ENABLED) throw new Error("Ad conversion delivery is disabled.");
      await sendTikTokConversion(job.payload);
      return;
    case "fulfill_legacy_order": {
      if (!deploymentControls().LEGACY_FULFILLMENT_ENABLED) throw new Error("Legacy purchase fulfillment is disabled.");
      const { sheetTab, ...order } = job.payload as unknown as LegacyOrder & { sheetTab: string };
      return new LegacyKeyFulfillmentService(firestore()).fulfill(order, sheetTab, new Date());
    }
    case "cancel_stripe_subscription": {
      if (!deploymentControls().SUBSCRIPTION_CANCELLATION_ENABLED) throw new Error("Automatic Stripe subscription cancellation is disabled.");
      const uid = String(job.payload.uid ?? "");
      const subscriptionId = String(job.payload.subscriptionId ?? "");
      const effective = await store.effectiveEntitlements(uid, new Date());
      if (effective.accessKind !== "lifetime") throw new Error("Refusing subscription cancellation before lifetime access is effective.");
      const subscription = await stripeClient().subscriptions.retrieve(subscriptionId);
      const linkedUid = await store.uidForProviderSubscription("stripe", subscriptionId);
      if (linkedUid !== uid) throw new Error("Refusing to cancel a subscription not linked to this account.");
      if (subscription.metadata.wl_uid && subscription.metadata.wl_uid !== uid) {
        throw new Error("Refusing to cancel a subscription owned by another Firebase UID.");
      }
      if (subscription.status !== "canceled") {
        await stripeClient().subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false });
      }
      return { subscriptionId, canceled: true };
    }
    case "email_receipt":
    case "allocate_legacy_key":
    case "mailerlite_sync":
      throw new Error(`Obsolete split job ${job.kind}; migrate it to fulfill_legacy_order.`);
    default: {
      const exhaustive: never = job.kind;
      throw new Error(`Unsupported outbox job ${exhaustive}`);
    }
  }
}

export async function runOutboxWorker(limit = 20): Promise<{ processed: number; failed: number }> {
  if (!deploymentControls().OUTBOX_PROCESSING_ENABLED) return { processed: 0, failed: 0 };
  const store = new EntitlementStore(firestore());
  const workerId = randomUUID();
  const jobs = await store.leaseOutboxJobs(workerId, new Date(), limit);
  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const result = await execute(job, store);
      await store.completeOutboxJob(job.id, new Date(), result);
      processed += 1;
    } catch (error) {
      console.error("Outbox job failed", { jobId: job.id, kind: job.kind, attempt: job.attemptCount, error });
      await store.failOutboxJob(job, error, new Date());
      failed += 1;
    }
  }
  return { processed, failed };
}
