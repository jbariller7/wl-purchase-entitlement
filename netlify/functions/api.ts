import type { Config } from "@netlify/functions";
import { withLambda } from "@netlify/aws-lambda-compat";
import type { HandlerEvent, HandlerResponse, LambdaHandler } from "@netlify/aws-lambda-compat";
import { z } from "zod";
import { CatalogService } from "../../src/catalog/service.js";
import { AdminImportService } from "../../src/admin/import-service.js";
import { CloudSaveService, cloudSaveSlotSchema, finalizeUploadSchema, prepareUploadSchema } from "../../src/cloud-save/service.js";
import { deploymentControls, env } from "../../src/config/env.js";
import { MONTHLY_PRICE_USD_CENTS, POLYGLOT_PERMANENT_PRICE_USD_CENTS, PREMIUM_LIFETIME_PRICE_USD_CENTS, STRIPE_SUBSCRIPTION_TRIAL_DAYS } from "../../src/domain/catalog.js";
import { REGIONAL_PRICES } from "../../src/domain/regional-pricing.js";
import { summarizeSubscription } from "../../src/domain/account-summary.js";
import { HttpError, requireUser } from "../../src/http/auth.js";
import { requireAppCheck } from "../../src/http/app-check.js";
import { apiAllowedOrigins, requestHeader, requireAllowedOrigin } from "../../src/http/origin.js";
import { consumeRateLimit, type RateLimitPolicy } from "../../src/http/rate-limit.js";
import { errorResponse, json, parseJsonBody } from "../../src/http/response.js";
import { EntitlementStore } from "../../src/infrastructure/entitlement-store.js";
import { firebaseAppCheck, firebaseAuth, firebaseStorage, firestore } from "../../src/infrastructure/firebase.js";
import { checkoutRequestSchema, createBillingPortal, createCheckout } from "../../src/providers/stripe/checkout-service.js";
import { claimHistoricalDesktopOrder } from "../../src/providers/stripe/legacy-claim-service.js";
import { syncGooglePlayOneTimeProduct, syncGooglePlaySubscription } from "../../src/providers/google-play/service.js";
import { sha256 } from "../../src/infrastructure/ids.js";
import { claimAppleTransaction } from "../../src/providers/apple/service.js";
import { ACCOUNT_DELETION_CONFIRMATION, AccountDeletionService } from "../../src/account-deletion/service.js";
import {
  DeviceSignInService,
  invalidateDeviceSignInsForUid,
  requireCurrentDeviceSessionGeneration
} from "../../src/device-sign-in/service.js";
import { SecondPlatformRequestService } from "../../src/premium/second-platform-request-service.js";

export const config: Config = {
  rateLimit: { windowSize: 60, windowLimit: 240, aggregateBy: ["domain", "ip"] }
};

const legacyClaimSchema = z.object({ checkoutSessionId: z.string().min(4).max(255) });
const googlePlayClaimSchema = z.object({
  kind: z.enum(["subscription", "one_time"]),
  productId: z.string().min(1).max(255),
  purchaseToken: z.string().min(16).max(4096)
});
const appleClaimSchema = z.object({ signedTransactionInfo: z.string().min(20).max(100_000) });
const revokeSessionsSchema = z.object({ confirmationPhrase: z.literal("SIGN OUT ALL DEVICES") });
const deletionCommitSchema = z.object({
  previewId: z.string().uuid(),
  confirmationPhrase: z.literal(ACCOUNT_DELETION_CONFIRMATION)
});
const deviceStartSchema = z.object({ deviceLabel: z.string().trim().min(1).max(64) });
const devicePollSchema = z.object({
  userCode: z.string().trim().min(8).max(9),
  pollSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/)
});
const deviceApprovalSchema = z.object({ userCode: z.string().trim().min(8).max(9) });

function routePath(event: HandlerEvent): string {
  return event.path
    .replace(/^\/\.netlify\/functions\/api/, "")
    .replace(/^\/api/, "") || "/";
}

function clientIp(event: HandlerEvent): string | undefined {
  const direct = requestHeader(event.headers, "x-nf-client-connection-ip");
  if (direct) return direct;
  return requestHeader(event.headers, "x-forwarded-for")?.split(",")[0]?.trim();
}

function isPublicDeviceSignInRoute(path: string): boolean {
  return path === "/v1/device-sign-in/config" || path === "/v1/device-sign-in/start" || path === "/v1/device-sign-in/poll";
}

function publicDeviceFirebaseConfig(): { firebaseApiKey: string; firebaseProjectId: string } {
  const parsed = z.object({
    FIREBASE_WEB_API_KEY: z.string().min(20).max(256),
    FIREBASE_PROJECT_ID: z.string().regex(/^[a-z][a-z0-9-]{4,29}$/)
  }).safeParse(process.env);
  if (!parsed.success) throw new HttpError(503, "PC/Mac sign-in configuration is incomplete.");
  return {
    firebaseApiKey: parsed.data.FIREBASE_WEB_API_KEY,
    firebaseProjectId: parsed.data.FIREBASE_PROJECT_ID
  };
}

function publicAccountFirebaseConfig(): {
  environment: "test" | "production";
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
} {
  const parsed = z.object({
    APP_ENVIRONMENT: z.enum(["test", "production"]).default("test"),
    FIREBASE_WEB_API_KEY: z.string().min(20).max(256),
    FIREBASE_AUTH_DOMAIN: z.string().min(4).max(253),
    FIREBASE_PROJECT_ID: z.string().regex(/^[a-z][a-z0-9-]{4,29}$/),
    FIREBASE_STORAGE_BUCKET: z.string().min(4).max(253).optional()
  }).safeParse(process.env);
  if (!parsed.success) throw new HttpError(503, "Account login is not configured yet. Finish Firebase web setup at /setup/.");
  return {
    environment: parsed.data.APP_ENVIRONMENT,
    apiKey: parsed.data.FIREBASE_WEB_API_KEY,
    authDomain: parsed.data.FIREBASE_AUTH_DOMAIN,
    projectId: parsed.data.FIREBASE_PROJECT_ID,
    ...(parsed.data.FIREBASE_STORAGE_BUCKET ? { storageBucket: parsed.data.FIREBASE_STORAGE_BUCKET } : {})
  };
}

function withCors(event: HandlerEvent, response: HandlerResponse): HandlerResponse {
  const origin = requestHeader(event.headers, "origin");
  const allowed = apiAllowedOrigins(true);
  const allowLocalFileOrigin = origin === "null" && isPublicDeviceSignInRoute(routePath(event));
  return {
    ...response,
    headers: {
      ...(response.headers ?? {}),
      ...(origin && (allowed.has(origin) || allowLocalFileOrigin) ? { "access-control-allow-origin": origin } : {}),
      "access-control-allow-headers": "authorization, content-type, x-firebase-appcheck",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      vary: "Origin"
    }
  };
}

function userRateLimitPolicy(method: string, path: string): RateLimitPolicy {
  if (path === "/v1/checkout") return { action: "checkout", limit: 8, windowSeconds: 10 * 60 };
  if (path === "/v1/billing-portal") return { action: "billing-portal", limit: 10, windowSeconds: 10 * 60 };
  if (path === "/v1/legacy/claim") return { action: "legacy-claim", limit: 10, windowSeconds: 60 * 60 };
  if (path === "/v1/google-play/claim" || path === "/v1/apple/claim") return { action: "store-claim", limit: 30, windowSeconds: 10 * 60 };
  if (path === "/v1/me/revoke-sessions" || path.startsWith("/v1/me/deletion-")) return { action: "account-security", limit: 10, windowSeconds: 10 * 60 };
  if (path.startsWith("/v1/me/second-platform-request")) return { action: "second-platform-request", limit: 6, windowSeconds: 60 * 60 };
  if (path.includes("/cloud-saves")) {
    return method === "GET"
      ? { action: "cloud-read", limit: 120, windowSeconds: 60 }
      : { action: "cloud-write", limit: 60, windowSeconds: 10 * 60 };
  }
  return method === "GET"
    ? { action: "account-read", limit: 120, windowSeconds: 60 }
    : { action: "account-write", limit: 60, windowSeconds: 10 * 60 };
}

async function dispatch(event: HandlerEvent): Promise<HandlerResponse> {
  const path = routePath(event);
  const origin = requestHeader(event.headers, "origin");
  if (!(origin === "null" && isPublicDeviceSignInRoute(path))) requireAllowedOrigin(origin, apiAllowedOrigins(true));
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, body: "" };
  if (event.httpMethod === "GET" && path === "/v1/config") {
    const publicFirebase = publicAccountFirebaseConfig();
    let runtime: ReturnType<typeof env> | undefined;
    try { runtime = env(); } catch { runtime = undefined; }
    const catalog = runtime ? await new CatalogService(firestore()).get() : {
      revision: 0,
      monthly: { unitAmount: MONTHLY_PRICE_USD_CENTS, currency: "USD", recurring: true },
      polyglot: { unitAmount: POLYGLOT_PERMANENT_PRICE_USD_CENTS, currency: "USD", recurring: false },
      premium: { unitAmount: PREMIUM_LIFETIME_PRICE_USD_CENTS, currency: "USD", recurring: false },
      regionalPrices: REGIONAL_PRICES
    };
    return json(200, {
      environment: publicFirebase.environment,
      accountApiReady: Boolean(runtime),
      checkoutEnabled: Boolean(runtime?.STRIPE_MUTATIONS_ENABLED),
      appCheckEnforced: Boolean(runtime?.APP_CHECK_ENFORCEMENT_ENABLED),
      firebase: {
        apiKey: publicFirebase.apiKey,
        authDomain: publicFirebase.authDomain,
        projectId: publicFirebase.projectId,
        ...(publicFirebase.storageBucket ? { storageBucket: publicFirebase.storageBucket } : {})
      },
      catalog: {
        revision: catalog.revision,
        monthly: catalog.monthly,
        polyglot: catalog.polyglot,
        premium: catalog.premium,
        regionalPrices: catalog.regionalPrices,
        monthlyUsdCents: catalog.monthly.currency === "USD" ? catalog.monthly.unitAmount : MONTHLY_PRICE_USD_CENTS,
        polyglotUsdCents: catalog.polyglot.currency === "USD" ? catalog.polyglot.unitAmount : POLYGLOT_PERMANENT_PRICE_USD_CENTS,
        premiumUsdCents: catalog.premium.currency === "USD" ? catalog.premium.unitAmount : PREMIUM_LIFETIME_PRICE_USD_CENTS,
        trialDays: STRIPE_SUBSCRIPTION_TRIAL_DAYS,
        monthlyIncludes: ["full_mobile_game", "cloud_save"],
        polyglotIncludes: ["full_game", "one_mobile_platform", "permanent_access"],
        premiumIncludes: ["polyglot_permanent", "one_pc_mac_access", "cross_platform_cloud_save", "future_sequels", "future_content", "second_mobile_platform_on_request"]
      }
    });
  }

  if (isPublicDeviceSignInRoute(path)) {
    if (!deploymentControls().DEVICE_SIGN_IN_ENABLED) throw new HttpError(503, "PC/Mac device sign-in is disabled in this deployment.");
    if (event.httpMethod === "GET" && path === "/v1/device-sign-in/config") {
      // Firebase Web API keys identify a client project; they are not private credentials.
      // Serve the restricted key from Netlify at runtime so no key is embedded in Git or a game build.
      return json(200, publicDeviceFirebaseConfig());
    }
    const db = firestore();
    const now = new Date();
    if (event.httpMethod === "POST" && path === "/v1/device-sign-in/start") {
      const parsed = deviceStartSchema.safeParse(parseJsonBody(event.body));
      if (!parsed.success) throw new HttpError(400, "A short PC/Mac device label is required.");
      await consumeRateLimit({
        db,
        namespace: "api",
        subject: `device-start:${sha256(clientIp(event) ?? "unknown")}`,
        policy: { action: "device-sign-in-start", limit: 10, windowSeconds: 60 * 60 },
        now
      });
      return json(201, await new DeviceSignInService(db, firebaseAuth()).start({
        deviceLabel: parsed.data.deviceLabel,
        now,
        publicAppOrigin: process.env.PUBLIC_APP_ORIGIN || "https://wonderlang.net"
      }));
    }
    if (event.httpMethod === "POST" && path === "/v1/device-sign-in/poll") {
      const parsed = devicePollSchema.safeParse(parseJsonBody(event.body));
      if (!parsed.success) throw new HttpError(400, "A valid device code and polling secret are required.");
      await consumeRateLimit({
        db,
        namespace: "api",
        subject: `device-poll:${sha256(`${parsed.data.pollSecret}:${clientIp(event) ?? "unknown"}`)}`,
        policy: { action: "device-sign-in-poll", limit: 240, windowSeconds: 10 * 60 },
        now
      });
      const result = await new DeviceSignInService(db, firebaseAuth()).poll({ ...parsed.data, now });
      return json(result.state === "pending" ? 202 : 200, result);
    }
    throw new HttpError(405, "Method Not Allowed");
  }

  const user = await requireUser(requestHeader(event.headers, "authorization"));
  await requireAppCheck(
    requestHeader(event.headers, "x-firebase-appcheck"),
    firebaseAppCheck(),
    deploymentControls().APP_CHECK_ENFORCEMENT_ENABLED
  );
  const db = firestore();
  await requireCurrentDeviceSessionGeneration(db, user);
  const store = new EntitlementStore(db);
  const secondPlatformRequests = new SecondPlatformRequestService(db);
  const now = new Date();
  await consumeRateLimit({
    db,
    namespace: "api",
    subject: user.uid,
    policy: userRateLimitPolicy(event.httpMethod, path),
    now
  });

  if (path.startsWith("/v1/device-sign-in/")) {
    if (!deploymentControls().DEVICE_SIGN_IN_ENABLED) throw new HttpError(503, "PC/Mac device sign-in is disabled in this deployment.");
    const service = new DeviceSignInService(db, firebaseAuth());
    const userCode = event.httpMethod === "GET"
      ? event.queryStringParameters?.code
      : deviceApprovalSchema.safeParse(parseJsonBody(event.body)).data?.userCode;
    if (!userCode) throw new HttpError(400, "Enter the device code shown by WonderLang.");
    if (event.httpMethod === "GET" && path === "/v1/device-sign-in/preview") {
      return json(200, await service.preview({ uid: user.uid, userCode, now }));
    }
    if (event.httpMethod === "POST" && path === "/v1/device-sign-in/approve") {
      if (!user.email || !user.email_verified) throw new HttpError(403, "Verify your WonderLang account email before approving a new device.");
      if (!user.auth_time || Math.floor(now.getTime() / 1000) - user.auth_time > 10 * 60) {
        throw new HttpError(401, "For security, sign out and sign in again before approving this device.");
      }
      return json(200, await service.approve({
        uid: user.uid,
        userCode,
        authTimeSeconds: user.auth_time,
        now
      }));
    }
    throw new HttpError(405, "Method Not Allowed");
  }

  if (event.httpMethod === "GET" && path === "/v1/me") {
    if (user.email && user.email_verified) {
      await new AdminImportService(db, firebaseAuth()).claimPendingForVerifiedUser({ uid: user.uid, email: user.email, now });
    }
    const [entitlements, discount, grants, authUser, cloudSlots, stripeCustomerId, secondPlatformRequest] = await Promise.all([
      store.effectiveEntitlements(user.uid, now),
      store.legacyDiscountClaim(user.uid),
      store.grantsForUid(user.uid),
      firebaseAuth().getUser(user.uid),
      db.collection("cloudSaves").doc(user.uid).collection("slots").get(),
      store.stripeCustomerId(user.uid),
      secondPlatformRequests.get(user.uid)
    ]);
    const cloudUpdates = cloudSlots.docs
      .map((doc) => doc.data()?.updatedAt as string | undefined)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => Date.parse(b) - Date.parse(a));
    return json(200, {
      uid: user.uid,
      email: user.email ?? null,
      linkedLoginProviders: authUser.providerData.map((provider) => provider.providerId).filter((provider) => provider !== "firebase"),
      entitlements,
      subscription: summarizeSubscription(grants),
      stripeBillingAvailable: Boolean(stripeCustomerId),
      secondMobilePlatformRequest: secondPlatformRequest,
      cloudSave: {
        enabled: entitlements.cloudSave,
        retainedWhenAccessEnds: true,
        slotCount: cloudSlots.size,
        lastUpdatedAt: cloudUpdates[0] ?? null
      },
      legacyLifetimeDiscount: {
        eligible: Boolean(discount?.verifiedDesktopTransactionIds.length && !discount.redeemedAt),
        redeemedAt: discount?.redeemedAt ?? null
      }
    });
  }

  if (event.httpMethod === "POST" && path === "/v1/me/second-platform-request") {
    if (!user.email || !user.email_verified) throw new HttpError(403, "Verify your WonderLang account email before requesting another mobile platform.");
    const entitlements = await store.effectiveEntitlements(user.uid, now);
    return json(201, await secondPlatformRequests.submit({ uid: user.uid, email: user.email, entitlements, now }));
  }

  if (event.httpMethod === "POST" && path === "/v1/me/second-platform-request/cancel") {
    return json(200, await secondPlatformRequests.cancel({ uid: user.uid, now }));
  }

  if (event.httpMethod === "POST" && path === "/v1/me/revoke-sessions") {
    const parsed = revokeSessionsSchema.safeParse(parseJsonBody(event.body));
    if (!parsed.success) throw new HttpError(400, "Type SIGN OUT ALL DEVICES to confirm.");
    const invalidated = await invalidateDeviceSignInsForUid(db, user.uid, now);
    await firebaseAuth().revokeRefreshTokens(user.uid);
    return json(200, { revoked: true, ...invalidated });
  }

  if (event.httpMethod === "POST" && path === "/v1/me/deletion-preview") {
    return json(200, await new AccountDeletionService(db, firebaseAuth()).preview(user.uid, now));
  }

  if (event.httpMethod === "POST" && path === "/v1/me/deletion-commit") {
    const parsed = deletionCommitSchema.safeParse(parseJsonBody(event.body));
    if (!parsed.success) throw new HttpError(400, `Type ${ACCOUNT_DELETION_CONFIRMATION} to confirm.`);
    if (!user.auth_time || Math.floor(now.getTime() / 1000) - user.auth_time > 10 * 60) {
      throw new HttpError(401, "For security, sign out and sign in again before scheduling account deletion.");
    }
    return json(200, await new AccountDeletionService(db, firebaseAuth()).commit({ uid: user.uid, ...parsed.data, now }));
  }

  if (event.httpMethod === "GET" && path === "/v1/store-account-token") {
    return json(200, { storeAccountToken: await store.storeAccountToken(user.uid, now) });
  }

  if (event.httpMethod === "POST" && path === "/v1/checkout") {
    const parsed = checkoutRequestSchema.safeParse(parseJsonBody(event.body));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join("; "));
    const ipAddress = clientIp(event);
    const userAgent = requestHeader(event.headers, "user-agent");
    const checkout = await createCheckout({
      store,
      user,
      request: parsed.data,
      ...(ipAddress ? { ipAddress } : {}),
      ...(userAgent ? { userAgent } : {}),
      now
    });
    return json(201, checkout);
  }

  if (event.httpMethod === "POST" && path === "/v1/billing-portal") {
    return json(201, { url: await createBillingPortal(store, user) });
  }

  if (event.httpMethod === "POST" && path === "/v1/legacy/claim") {
    const parsed = legacyClaimSchema.safeParse(parseJsonBody(event.body));
    if (!parsed.success) throw new HttpError(400, "A Stripe Checkout Session ID is required.");
    return json(200, await claimHistoricalDesktopOrder({
      store,
      user,
      checkoutSessionId: parsed.data.checkoutSessionId,
      now
    }));
  }

  if (event.httpMethod === "POST" && path === "/v1/google-play/claim") {
    const parsed = googlePlayClaimSchema.safeParse(parseJsonBody(event.body));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join("; "));
    const source = {
      store,
      purchaseToken: parsed.data.purchaseToken,
      authenticatedUid: user.uid,
      eventId: `app-claim:${sha256(parsed.data.purchaseToken)}`,
      eventCreated: Math.floor(now.getTime() / 1000)
    };
    const entitlements = parsed.data.kind === "subscription"
      ? await syncGooglePlaySubscription(source)
      : await syncGooglePlayOneTimeProduct({ ...source, productId: parsed.data.productId });
    return json(200, { entitlements });
  }

  if (event.httpMethod === "POST" && path === "/v1/apple/claim") {
    const parsed = appleClaimSchema.safeParse(parseJsonBody(event.body));
    if (!parsed.success) throw new HttpError(400, "A signed StoreKit 2 transaction is required.");
    return json(200, {
      entitlements: await claimAppleTransaction({
        store,
        authenticatedUid: user.uid,
        signedTransactionInfo: parsed.data.signedTransactionInfo,
        now
      })
    });
  }

  const cloudSave = new CloudSaveService(db, firebaseStorage(), store);
  if (event.httpMethod === "GET" && path === "/v1/cloud-saves") {
    return json(200, { saves: await cloudSave.list(user.uid, now) });
  }
  if (event.httpMethod === "POST" && path === "/v1/cloud-saves/prepare-upload") {
    const parsed = prepareUploadSchema.safeParse(parseJsonBody(event.body));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join("; "));
    return json(201, await cloudSave.prepareUpload(user.uid, parsed.data, now));
  }
  if (event.httpMethod === "POST" && path === "/v1/cloud-saves/finalize") {
    const parsed = finalizeUploadSchema.safeParse(parseJsonBody(event.body));
    if (!parsed.success) throw new HttpError(400, "A valid upload ID is required.");
    return json(200, await cloudSave.finalizeUpload(user.uid, parsed.data.uploadId, now));
  }
  const downloadMatch = path.match(/^\/v1\/cloud-saves\/([^/]+)$/);
  if (event.httpMethod === "GET" && downloadMatch?.[1]) {
    const slot = cloudSaveSlotSchema.safeParse(downloadMatch[1]);
    if (!slot.success) throw new HttpError(400, slot.error.issues[0]?.message ?? "Invalid cloud-save slot.");
    return json(200, await cloudSave.downloadUrl(user.uid, slot.data, now));
  }
  return json(404, { error: "Not found" });
}

export const lambdaHandler: LambdaHandler = async (event) => {
  try { return withCors(event, await dispatch(event)); }
  catch (error) { return withCors(event, errorResponse(error)); }
};

export default withLambda(lambdaHandler);
