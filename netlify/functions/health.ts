import { withLambda } from "@netlify/aws-lambda-compat";
import type { LambdaHandler } from "@netlify/aws-lambda-compat";
import { deploymentControls } from "../../src/config/env.js";

function present(...names: string[]): boolean {
  return names.every((name) => Boolean(process.env[name]?.trim()));
}

export const lambdaHandler: LambdaHandler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405, body: "Method Not Allowed" };
  const controls = deploymentControls();
  const configuration = {
    firebaseAdmin: present("FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY", "FIREBASE_STORAGE_BUCKET"),
    firebaseWeb: present("FIREBASE_WEB_API_KEY", "FIREBASE_AUTH_DOMAIN", "FIREBASE_PROJECT_ID"),
    stripeTest: present("STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_MOBILE_MONTHLY", "STRIPE_PRICE_POLYGLOT_PERMANENT", "STRIPE_PRICE_PREMIUM_LIFETIME", "STRIPE_COUPON_LEGACY_DESKTOP_50") && Boolean(process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")),
    legacyFulfillment: present("GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY", "GOOGLE_SHEET_ID", "MAILERLITE_API_TOKEN"),
    adDelivery: present("META_PIXEL_ID", "META_ACCESS_TOKEN", "TIKTOK_PIXEL_ID", "TIKTOK_ACCESS_TOKEN"),
    googlePlay: present("GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY", "GOOGLE_PLAY_PACKAGE_NAME", "GOOGLE_PLAY_RTDN_AUDIENCE", "GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL"),
    appleStore: present("APPLE_BUNDLE_ID", "APPLE_KEY_ID", "APPLE_ISSUER_ID", "APPLE_PRIVATE_KEY", "APPLE_ROOT_CA_G2_BASE64", "APPLE_ROOT_CA_G3_BASE64"),
    providerTokenEncryption: present("PROVIDER_TOKEN_ENCRYPTION_KEYS")
  };
  const accountTesting = configuration.firebaseAdmin && configuration.firebaseWeb;
  const checkoutTesting = accountTesting && configuration.stripeTest;
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'"
    },
    body: JSON.stringify({
      status: checkoutTesting
        ? "ready_for_checkout_testing"
        : accountTesting
          ? "ready_for_account_testing"
          : "configuration_required",
      readiness: { accountTesting, checkoutTesting },
      environment: controls.APP_ENVIRONMENT,
      safeMode: !controls.STRIPE_WEBHOOKS_ENABLED && !controls.GOOGLE_PLAY_WEBHOOKS_ENABLED && !controls.APPLE_WEBHOOKS_ENABLED && !controls.OUTBOX_PROCESSING_ENABLED && !controls.AD_CONVERSIONS_ENABLED && !controls.LEGACY_FULFILLMENT_ENABLED && !controls.SUBSCRIPTION_CANCELLATION_ENABLED && !controls.ACCOUNT_DELETION_PROCESSING_ENABLED && !controls.STRIPE_MUTATIONS_ENABLED && !controls.SUBSCRIPTION_RECONCILIATION_ENABLED && !controls.CLOUD_STORAGE_MONITORING_ENABLED && !controls.CLOUD_SAVE_CLEANUP_ENABLED && !controls.DEVICE_SIGN_IN_ENABLED && !controls.DEVICE_SIGN_IN_CLEANUP_ENABLED && !controls.ADMIN_BOOTSTRAP_ENABLED,
      controls,
      configuration,
      deploy: process.env.COMMIT_REF?.slice(0, 12) ?? null
    })
  };
};

export default withLambda(lambdaHandler);
