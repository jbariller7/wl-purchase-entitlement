import { z } from "zod";
import { parseInventoryStockPolicy } from "./inventory-policy.js";

const disabledByDefault = z.enum(["true", "false"]).default("false").transform((value) => value === "true");

const controlsSchema = z.object({
  APP_ENVIRONMENT: z.enum(["test", "production"]).default("test"),
  STRIPE_WEBHOOKS_ENABLED: disabledByDefault,
  GOOGLE_PLAY_WEBHOOKS_ENABLED: disabledByDefault,
  APPLE_WEBHOOKS_ENABLED: disabledByDefault,
  OUTBOX_PROCESSING_ENABLED: disabledByDefault,
  AD_CONVERSIONS_ENABLED: disabledByDefault,
  LEGACY_FULFILLMENT_ENABLED: disabledByDefault,
  SUBSCRIPTION_CANCELLATION_ENABLED: disabledByDefault,
  ACCOUNT_DELETION_PROCESSING_ENABLED: disabledByDefault,
  STRIPE_MUTATIONS_ENABLED: disabledByDefault,
  APP_CHECK_ENFORCEMENT_ENABLED: disabledByDefault,
  SUBSCRIPTION_RECONCILIATION_ENABLED: disabledByDefault,
  CLOUD_STORAGE_MONITORING_ENABLED: disabledByDefault,
  CLOUD_SAVE_CLEANUP_ENABLED: disabledByDefault,
  DEVICE_SIGN_IN_ENABLED: disabledByDefault,
  DEVICE_SIGN_IN_CLEANUP_ENABLED: disabledByDefault
});

const schema = controlsSchema.extend({
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().email(),
  FIREBASE_PRIVATE_KEY: z.string().min(1),
  FIREBASE_STORAGE_BUCKET: z.string().min(1),
  FIREBASE_WEB_API_KEY: z.string().min(1),
  FIREBASE_AUTH_DOMAIN: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRICE_MOBILE_MONTHLY: z.string().min(1),
  STRIPE_PRICE_POLYGLOT_PERMANENT: z.string().min(1),
  STRIPE_PRICE_PREMIUM_LIFETIME: z.string().min(1),
  STRIPE_COUPON_LEGACY_DESKTOP_50: z.string().min(1),
  STRIPE_SUCCESS_URL: z.string().url(),
  STRIPE_CANCEL_URL: z.string().url(),
  STRIPE_PORTAL_RETURN_URL: z.string().url(),
  PUBLIC_APP_ORIGIN: z.string().url(),
  META_PIXEL_ID: z.string().optional(),
  META_ACCESS_TOKEN: z.string().optional(),
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).optional().default("v23.0"),
  META_TEST_EVENT_CODE: z.string().optional(),
  TIKTOK_PIXEL_ID: z.string().optional(),
  TIKTOK_ACCESS_TOKEN: z.string().optional(),
  TIKTOK_TEST_EVENT_CODE: z.string().optional(),
  GOOGLE_PLAY_PACKAGE_NAME: z.string().optional().default("com.wonderlang.app"),
  GOOGLE_PLAY_MONTHLY_PRODUCT_ID: z.string().optional().default("wonderlangmonthly"),
  GOOGLE_PLAY_POLYGLOT_PRODUCT_ID: z.string().optional().default("wonderlangfull"),
  GOOGLE_PLAY_RTDN_AUDIENCE: z.string().optional(),
  GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
  PROVIDER_TOKEN_ENCRYPTION_KEYS: z.string().optional(),
  CLOUD_STORAGE_DAILY_GROWTH_ALERT_BYTES: z.coerce.number().int().positive().optional().default(500 * 1024 * 1024),
  KEY_INVENTORY_DEFAULT_LOW_STOCK_THRESHOLD: z.coerce.number().int().min(0).max(1_000_000).optional().default(10),
  KEY_INVENTORY_LOW_STOCK_THRESHOLDS: z.string().optional().default("{}"),
  APPLE_BUNDLE_ID: z.string().optional(),
  APPLE_APP_ID: z.string().regex(/^\d+$/).optional(),
  APPLE_MONTHLY_PRODUCT_ID: z.string().optional().default("wonderlangmonthly"),
  APPLE_POLYGLOT_PRODUCT_ID: z.string().optional().default("wonderlangfull"),
  APPLE_ISSUER_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),
  APPLE_ROOT_CA_G2_BASE64: z.string().optional(),
  APPLE_ROOT_CA_G3_BASE64: z.string().optional(),
  APPLE_ENVIRONMENT: z.enum(["Production", "Sandbox"]).optional().default("Production")
});

export type Environment = z.infer<typeof schema>;
export type DeploymentControls = z.infer<typeof controlsSchema>;
let cached: Environment | undefined;
let cachedControls: DeploymentControls | undefined;

export function deploymentControls(): DeploymentControls {
  if (!cachedControls) {
    const parsed = controlsSchema.safeParse(process.env);
    if (!parsed.success) {
      const names = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
      throw new Error(`Missing or invalid deployment controls: ${names}`);
    }
    cachedControls = parsed.data;
  }
  return cachedControls;
}

export function env(): Environment {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const names = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
      throw new Error(`Missing or invalid service configuration: ${names}`);
    }
    cached = parsed.data;
    const stripeMode = cached.STRIPE_SECRET_KEY.startsWith("sk_live_") ? "production"
      : cached.STRIPE_SECRET_KEY.startsWith("sk_test_") ? "test"
        : "unknown";
    if (cached.APP_ENVIRONMENT === "test" && stripeMode !== "test") {
      cached = undefined;
      throw new Error("Test deployments require a Stripe sk_test_ key; live or unrecognized keys are refused.");
    }
    if (cached.APP_ENVIRONMENT === "production" && stripeMode !== "production") {
      cached = undefined;
      throw new Error("Production deployments require a Stripe sk_live_ key.");
    }
    parseInventoryStockPolicy({
      defaultThreshold: cached.KEY_INVENTORY_DEFAULT_LOW_STOCK_THRESHOLD,
      thresholdsJson: cached.KEY_INVENTORY_LOW_STOCK_THRESHOLDS
    });
  }
  return cached;
}

export function resetEnvironmentForTests(): void {
  cached = undefined;
  cachedControls = undefined;
}
