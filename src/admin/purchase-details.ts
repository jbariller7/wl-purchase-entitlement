import type { Firestore } from 'firebase-admin/firestore';
import { HttpError } from '../http/auth.js';
import { stableDocumentId } from '../infrastructure/ids.js';
import { websiteStripeClient } from '../providers/stripe/website-config.js';
import { websiteDesktopRoute } from '../providers/stripe/website-commerce.js';
import { websiteSessionSchema } from '../providers/stripe/website-session.js';
import { websiteDelivery } from '../legacy/website-delivery.js';

export const PURCHASE_LABELS: Record<string, string> = {
  single: 'Single language — PC/Mac', polyglot: 'Polyglot — PC/Mac',
  premium: 'Premium Lifetime Pass', mobile_permanent: 'Polyglot — Mobile permanent',
  mobile_monthly: 'Mobile monthly subscription'
};

/** Admin-only, explicit allowlist: never return claim tokens or attribution data. */
export async function purchaseDetails(db: Firestore, sessionId: string) {
  const order = (await db.collection('websiteOrders').doc(sessionId).get()).data();
  if (!order) throw new HttpError(404, 'Website purchase not found.');
  const jobId = stableDocumentId('purchase_confirmation', `checkout:${sessionId}`);
  const [emailSnap, jobSnap, fulfillmentSnap] = await Promise.all([
    db.collection('orderEmailDeliveries').doc(jobId).get(),
    db.collection('outbox').doc(jobId).get(),
    db.collection('legacyFulfillments').doc(sessionId).get()
  ]);
  const email = emailSnap.data(), job = jobSnap.data(), fulfillment = fulfillmentSnap.data();
  const warnings: string[] = [];
  let keys = Array.isArray(fulfillment?.keys) ? fulfillment.keys.map((k: {key: string}) => k.key) : [];
  if (!keys.length) {
    const request = websiteSessionSchema.safeParse(order.request);
    if (request.success) {
      const route = websiteDesktopRoute(request.data);
      if (route) {
        try { keys = (await websiteDelivery(db, sessionId, order.buyerEmail, route.sheetTab)).map(k => k.key); }
        catch { warnings.push('The key registry could not be read. No new key was allocated.'); }
      }
    } else warnings.push('The saved order configuration needs review.');
  }
  let payment: {amount: number | null; currency: string | null; status: string; paymentIntentId: string | null} | null = null;
  try {
    const session = await websiteStripeClient().checkout.sessions.retrieve(sessionId);
    payment = {amount: session.amount_total, currency: session.currency, status: session.payment_status,
      paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null};
  } catch { warnings.push('Live Stripe payment details are temporarily unavailable.'); }
  return {
    sessionId, buyerEmail: order.buyerEmail, product: PURCHASE_LABELS[order.request?.offer] ?? 'Unknown product',
    delivery: order.request?.delivery ?? null, learningLanguage: order.request?.learningLanguage ?? null,
    purchasedAt: Number.isFinite(order.sourceEventCreated) ? new Date(order.sourceEventCreated * 1000).toISOString() : order.createdAt ?? null,
    claimedByUid: order.claimedByUid ?? null, payment, warnings,
    fulfillment: {keys, recordedAt: fulfillment?.createdAt ?? null},
    email: {state: email?.state ?? job?.state ?? 'not_recorded', sentAt: email?.sentAt ?? null,
      startedAt: email?.startedAt ?? null, locale: email?.locale ?? null, messageId: email?.messageId ?? null,
      attempts: job?.attemptCount ?? null}
  };
}
