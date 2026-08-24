export type Provider = "stripe" | "google_play" | "apple" | "steam" | "itch" | "admin";

export type Product =
  | "mobile_full_monthly"
  | "mobile_full_lifetime"
  | "legacy_chapter_1"
  | "legacy_chapter_2"
  | "legacy_chapter_3"
  | "legacy_chapter_4"
  | "legacy_mobile_full"
  | "desktop_language"
  | "desktop_polyglot"
  | "desktop_lifetime";

export type LedgerState = "active" | "grace" | "pending" | "expired" | "revoked" | "refunded";

export interface LedgerGrant {
  id: string;
  uid: string;
  provider: Provider;
  providerCustomerId?: string;
  providerTransactionId: string;
  providerSubscriptionId?: string;
  product: Product;
  state: LedgerState;
  startsAt: string;
  currentPeriodEndsAt?: string;
  graceEndsAt?: string;
  endsAt?: string;
  refundedAt?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface EffectiveEntitlements {
  uid: string;
  computedAt: string;
  revision: number;
  fullGame: boolean;
  allLanguages: boolean;
  cloudSave: boolean;
  chapters: number[];
  accessKind: "lifetime" | "subscription" | "legacy" | "none";
  subscriptionState: "active" | "grace" | "inactive";
  subscriptionEndsAt?: string;
  graceEndsAt?: string;
  sourceGrantIds: string[];
}

export type ProviderEventStatus = "received" | "processing" | "processed" | "failed" | "released";

export interface ProviderEventRecord {
  id: string;
  provider: Provider;
  providerEventId: string;
  eventType: string;
  receivedAt: string;
  status: ProviderEventStatus;
  attemptCount: number;
  payloadSha256: string;
  processedAt?: string;
  lastError?: string;
}

export type OutboxKind =
  | "fulfill_legacy_order"
  | "email_receipt"
  | "allocate_legacy_key"
  | "mailerlite_sync"
  | "meta_conversion"
  | "tiktok_conversion"
  | "cancel_stripe_subscription";

export interface OutboxJob {
  id: string;
  kind: OutboxKind;
  dedupeKey: string;
  createdAt: string;
  notBefore: string;
  attemptCount: number;
  state: "pending" | "processing" | "complete" | "failed";
  payload: Record<string, unknown>;
  completedAt?: string;
  lastError?: string;
}

export interface LegacyOrder {
  id: string;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId?: string;
  buyerEmail: string;
  paymentLinkId?: string;
  productCode: string;
  playMode: "STEAM" | "DIRECT";
  quantity: number;
  amountTotal: number;
  currency: string;
  paidAt: string;
  firebaseUid?: string;
}
