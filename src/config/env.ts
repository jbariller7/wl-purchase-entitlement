import { z } from "zod";

const schema = z.object({
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().email(),
  FIREBASE_PRIVATE_KEY: z.string().min(1),
  FIREBASE_STORAGE_BUCKET: z.string().min(1),
  FIREBASE_WEB_API_KEY: z.string().min(1),
  FIREBASE_AUTH_DOMAIN: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRICE_MOBILE_MONTHLY: z.string().min(1),
  STRIPE_PRICE_MOBILE_LIFETIME: z.string().min(1),
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
  GOOGLE_PLAY_RTDN_AUDIENCE: z.string().optional(),
  GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
  APPLE_BUNDLE_ID: z.string().optional(),
  APPLE_APP_ID: z.string().regex(/^\d+$/).optional(),
  APPLE_MONTHLY_PRODUCT_ID: z.string().optional().default("wonderlangmonthly"),
  APPLE_LIFETIME_PRODUCT_ID: z.string().optional().default("wonderlangfull"),
  APPLE_ISSUER_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),
  APPLE_ROOT_CA_G2_BASE64: z.string().optional(),
  APPLE_ROOT_CA_G3_BASE64: z.string().optional(),
  APPLE_ENVIRONMENT: z.enum(["Production", "Sandbox"]).optional().default("Production")
});

export type Environment = z.infer<typeof schema>;
let cached: Environment | undefined;

export function env(): Environment {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const names = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
      throw new Error(`Missing or invalid service configuration: ${names}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function resetEnvironmentForTests(): void {
  cached = undefined;
}
