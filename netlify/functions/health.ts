import { withLambda } from "@netlify/aws-lambda-compat";
import type { LambdaHandler } from "@netlify/aws-lambda-compat";
import {
  appleEnv,
  deploymentControls,
  firebaseAdminEnv,
  googlePlayEnv,
  providerTokenEncryptionEnv,
  stripeEnv
} from "../../src/config/env.js";

function present(...names: string[]): boolean {
  return names.every((name) => Boolean(process.env[name]?.trim()));
}

function valid(configuration: () => unknown): boolean {
  try {
    configuration();
    return true;
  } catch {
    return false;
  }
}

export const lambdaHandler: LambdaHandler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405, body: "Method Not Allowed" };
  const controls = deploymentControls();
  const configuration = {
    firebaseAdmin: valid(firebaseAdminEnv),
    firebaseWeb: present("FIREBASE_WEB_API_KEY", "FIREBASE_AUTH_DOMAIN", "FIREBASE_PROJECT_ID"),
    stripeTest: controls.APP_ENVIRONMENT === "test" && valid(stripeEnv),
    legacyFulfillment: present("GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY", "GOOGLE_SHEET_ID", "MAILERLITE_API_TOKEN"),
    adDelivery: present("META_PIXEL_ID", "META_ACCESS_TOKEN", "TIKTOK_PIXEL_ID", "TIKTOK_ACCESS_TOKEN"),
    googlePlay: valid(googlePlayEnv),
    appleStore: valid(appleEnv),
    providerTokenEncryption: valid(providerTokenEncryptionEnv)
  };
  const accountTesting = configuration.firebaseAdmin && configuration.firebaseWeb;
  const stripeConfigured = accountTesting && configuration.stripeTest;
  const checkoutTesting = stripeConfigured && controls.STRIPE_MUTATIONS_ENABLED && controls.STRIPE_WEBHOOKS_ENABLED;
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
        : stripeConfigured
          ? "ready_for_stripe_canary"
        : accountTesting
          ? "ready_for_account_testing"
          : "configuration_required",
      readiness: { accountTesting, stripeConfigured, checkoutTesting },
      environment: controls.APP_ENVIRONMENT,
      safeMode: !controls.STRIPE_WEBHOOKS_ENABLED && !controls.GOOGLE_PLAY_WEBHOOKS_ENABLED && !controls.APPLE_WEBHOOKS_ENABLED && !controls.OUTBOX_PROCESSING_ENABLED && !controls.AD_CONVERSIONS_ENABLED && !controls.LEGACY_FULFILLMENT_ENABLED && !controls.SUBSCRIPTION_CANCELLATION_ENABLED && !controls.ACCOUNT_DELETION_PROCESSING_ENABLED && !controls.STRIPE_MUTATIONS_ENABLED && !controls.SUBSCRIPTION_RECONCILIATION_ENABLED && !controls.CLOUD_STORAGE_MONITORING_ENABLED && !controls.CLOUD_SAVE_CLEANUP_ENABLED && !controls.DEVICE_SIGN_IN_ENABLED && !controls.DEVICE_SIGN_IN_CLEANUP_ENABLED && !controls.ADMIN_BOOTSTRAP_ENABLED,
      controls,
      configuration,
      deploy: process.env.COMMIT_REF?.slice(0, 12) ?? null
    })
  };
};

export default withLambda(lambdaHandler);
