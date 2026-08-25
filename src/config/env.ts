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
  DEVICE_SIGN_IN_CLEANUP_ENABLED: disabledByDefault,
  ADMIN_BOOTSTRAP_ENABLED: disabledByDefault
});

const firebaseAdminSchema = z.object({
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().email(),
  FIREBASE_PRIVATE_KEY: z.string().min(1),
  FIREBASE_STORAGE_BUCKET: z.string().min(1)
});

const googlePlaySchema = z.object({
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email(),
  GOOGLE_PRIVATE_KEY: z.string().min(1),
  GOOGLE_PLAY_PACKAGE_NAME: z.string().min(1).default("com.wonderlang.app"),
  GOOGLE_PLAY_MONTHLY_PRODUCT_ID: z.string().min(1).default("wonderlangmonthly"),
  GOOGLE_PLAY_POLYGLOT_PRODUCT_ID: z.string().min(1).default("wonderlangfull"),
  GOOGLE_PLAY_RTDN_AUDIENCE: z.string().url(),
  GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL: z.string().email()
});

const providerTokenEncryptionSchema = z.object({
  PROVIDER_TOKEN_ENCRYPTION_KEYS: z.string().min(1)
});

const stripeSchema = z.object({
  APP_ENVIRONMENT: controlsSchema.shape.APP_ENVIRONMENT,
  STRIPE_MUTATIONS_ENABLED: controlsSchema.shape.STRIPE_MUTATIONS_ENABLED,
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRICE_MOBILE_MONTHLY: z.string().min(1),
  STRIPE_PRICE_POLYGLOT_PERMANENT: z.string().min(1),
  STRIPE_PRICE_PREMIUM_LIFETIME: z.string().min(1),
  STRIPE_COUPON_LEGACY_DESKTOP_50: z.string().min(1),
  STRIPE_SUCCESS_URL: z.string().url(),
  STRIPE_CANCEL_URL: z.string().url(),
  STRIPE_PORTAL_RETURN_URL: z.string().url(),
  PUBLIC_APP_ORIGIN: z.string().url()
});

const appleSchema = z.object({
  APPLE_BUNDLE_ID: z.string().min(1),
  APPLE_APP_ID: z.string().regex(/^\d+$/).optional(),
  APPLE_MONTHLY_PRODUCT_ID: z.string().min(1).default("wonderlangmonthly"),
  APPLE_POLYGLOT_PRODUCT_ID: z.string().min(1).default("wonderlangfull"),
  APPLE_ISSUER_ID: z.string().min(1),
  APPLE_KEY_ID: z.string().min(1),
  APPLE_PRIVATE_KEY: z.string().min(1),
  APPLE_ROOT_CA_G2_BASE64: z.string().min(1),
  APPLE_ROOT_CA_G3_BASE64: z.string().min(1),
  APPLE_ENVIRONMENT: z.enum(["Production", "Sandbox"]).default("Production")
});

const metaConversionSchema = z.object({
  META_PIXEL_ID: z.string().min(1),
  META_ACCESS_TOKEN: z.string().min(1),
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v23.0"),
  META_TEST_EVENT_CODE: z.string().min(1).optional()
});

const tiktokConversionSchema = z.object({
  TIKTOK_PIXEL_ID: z.string().min(1),
  TIKTOK_ACCESS_TOKEN: z.string().min(1),
  TIKTOK_TEST_EVENT_CODE: z.string().min(1).optional()
});

const cloudStorageMonitoringSchema = z.object({
  CLOUD_STORAGE_DAILY_GROWTH_ALERT_BYTES: z.coerce.number().int().positive().default(500 * 1024 * 1024)
});

const schema = controlsSchema.extend({
  ...firebaseAdminSchema.shape,
  FIREBASE_WEB_API_KEY: z.string().min(1),
  FIREBASE_AUTH_DOMAIN: z.string().min(1),
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),
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
  GOOGLE_SERVICE_ACCOUNT_EMAIL: googlePlaySchema.shape.GOOGLE_SERVICE_ACCOUNT_EMAIL.optional(),
  GOOGLE_PRIVATE_KEY: googlePlaySchema.shape.GOOGLE_PRIVATE_KEY.optional(),
  GOOGLE_PLAY_PACKAGE_NAME: googlePlaySchema.shape.GOOGLE_PLAY_PACKAGE_NAME.optional().default("com.wonderlang.app"),
  GOOGLE_PLAY_MONTHLY_PRODUCT_ID: googlePlaySchema.shape.GOOGLE_PLAY_MONTHLY_PRODUCT_ID.optional().default("wonderlangmonthly"),
  GOOGLE_PLAY_POLYGLOT_PRODUCT_ID: googlePlaySchema.shape.GOOGLE_PLAY_POLYGLOT_PRODUCT_ID.optional().default("wonderlangfull"),
  GOOGLE_PLAY_RTDN_AUDIENCE: googlePlaySchema.shape.GOOGLE_PLAY_RTDN_AUDIENCE.optional(),
  GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL: googlePlaySchema.shape.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL.optional(),
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
export type FirebaseAdminEnvironment = z.infer<typeof firebaseAdminSchema>;
export type GooglePlayEnvironment = z.infer<typeof googlePlaySchema>;
export type ProviderTokenEncryptionEnvironment = z.infer<typeof providerTokenEncryptionSchema>;
export type StripeEnvironment = z.infer<typeof stripeSchema>;
export type AppleEnvironment = z.infer<typeof appleSchema>;
export type MetaConversionEnvironment = z.infer<typeof metaConversionSchema>;
export type TikTokConversionEnvironment = z.infer<typeof tiktokConversionSchema>;
export type CloudStorageMonitoringEnvironment = z.infer<typeof cloudStorageMonitoringSchema>;
let cached: Environment | undefined;
let cachedControls: DeploymentControls | undefined;
let cachedFirebaseAdmin: FirebaseAdminEnvironment | undefined;
let cachedGooglePlay: GooglePlayEnvironment | undefined;
let cachedProviderTokenEncryption: ProviderTokenEncryptionEnvironment | undefined;
let cachedStripe: StripeEnvironment | undefined;
let cachedApple: AppleEnvironment | undefined;
let cachedMetaConversion: MetaConversionEnvironment | undefined;
let cachedTikTokConversion: TikTokConversionEnvironment | undefined;
let cachedCloudStorageMonitoring: CloudStorageMonitoringEnvironment | undefined;

function assertStripeMode(configuration: Pick<StripeEnvironment, "APP_ENVIRONMENT" | "STRIPE_SECRET_KEY">): void {
  const stripeMode = configuration.STRIPE_SECRET_KEY.startsWith("sk_live_") ? "production"
    : configuration.STRIPE_SECRET_KEY.startsWith("sk_test_") ? "test"
      : "unknown";
  if (configuration.APP_ENVIRONMENT === "test" && stripeMode !== "test") {
    throw new Error("Test deployments require a Stripe sk_test_ key; live or unrecognized keys are refused.");
  }
  if (configuration.APP_ENVIRONMENT === "production" && stripeMode !== "production") {
    throw new Error("Production deployments require a Stripe sk_live_ key.");
  }
}

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

export function firebaseAdminEnv(): FirebaseAdminEnvironment {
  if (!cachedFirebaseAdmin) {
    const parsed = firebaseAdminSchema.safeParse(process.env);
    if (!parsed.success) {
      const names = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
      throw new Error(`Missing or invalid Firebase Admin configuration: ${names}`);
    }
    cachedFirebaseAdmin = parsed.data;
  }
  return cachedFirebaseAdmin;
}

export function googlePlayEnv(): GooglePlayEnvironment {
  if (!cachedGooglePlay) {
    const parsed = googlePlaySchema.safeParse(process.env);
    if (!parsed.success) {
      const names = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
      throw new Error(`Missing or invalid Google Play configuration: ${names}`);
    }
    cachedGooglePlay = parsed.data;
  }
  return cachedGooglePlay;
}

export function providerTokenEncryptionEnv(): ProviderTokenEncryptionEnvironment {
  if (!cachedProviderTokenEncryption) {
    const parsed = providerTokenEncryptionSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error("Provider token encryption is not configured.");
    }
    cachedProviderTokenEncryption = parsed.data;
  }
  return cachedProviderTokenEncryption;
}

export function stripeEnv(): StripeEnvironment {
  if (!cachedStripe) {
    const parsed = stripeSchema.safeParse(process.env);
    if (!parsed.success) {
      const names = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
      throw new Error(`Missing or invalid Stripe configuration: ${names}`);
    }
    assertStripeMode(parsed.data);
    cachedStripe = parsed.data;
  }
  return cachedStripe;
}

export function appleEnv(): AppleEnvironment {
  if (!cachedApple) {
    const parsed = appleSchema.safeParse(process.env);
    if (!parsed.success) {
      const names = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
      throw new Error(`Missing or invalid Apple configuration: ${names}`);
    }
    if (parsed.data.APPLE_ENVIRONMENT === "Production" && !parsed.data.APPLE_APP_ID) {
      throw new Error("APPLE_APP_ID is required in Production.");
    }
    cachedApple = parsed.data;
  }
  return cachedApple;
}

export function metaConversionEnv(): MetaConversionEnvironment {
  if (!cachedMetaConversion) {
    const parsed = metaConversionSchema.safeParse(process.env);
    if (!parsed.success) throw new Error("Meta conversion credentials are not configured.");
    cachedMetaConversion = parsed.data;
  }
  return cachedMetaConversion;
}

export function tiktokConversionEnv(): TikTokConversionEnvironment {
  if (!cachedTikTokConversion) {
    const parsed = tiktokConversionSchema.safeParse(process.env);
    if (!parsed.success) throw new Error("TikTok conversion credentials are not configured.");
    cachedTikTokConversion = parsed.data;
  }
  return cachedTikTokConversion;
}

export function cloudStorageMonitoringEnv(): CloudStorageMonitoringEnvironment {
  if (!cachedCloudStorageMonitoring) {
    const parsed = cloudStorageMonitoringSchema.safeParse(process.env);
    if (!parsed.success) throw new Error("Cloud storage monitoring configuration is invalid.");
    cachedCloudStorageMonitoring = parsed.data;
  }
  return cachedCloudStorageMonitoring;
}

export function env(): Environment {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const names = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
      throw new Error(`Missing or invalid service configuration: ${names}`);
    }
    cached = parsed.data;
    try {
      assertStripeMode(cached);
    } catch (error) {
      cached = undefined;
      throw error;
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
  cachedFirebaseAdmin = undefined;
  cachedGooglePlay = undefined;
  cachedProviderTokenEncryption = undefined;
  cachedStripe = undefined;
  cachedApple = undefined;
  cachedMetaConversion = undefined;
  cachedTikTokConversion = undefined;
  cachedCloudStorageMonitoring = undefined;
}
