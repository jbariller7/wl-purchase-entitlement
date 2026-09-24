import { ReviewerAccounts } from "../../src/admin/reviewer-accounts.js";
import type { Config } from "@netlify/functions";
import { withLambda } from "@netlify/aws-lambda-compat";
import type { HandlerEvent, HandlerResponse, LambdaHandler } from "@netlify/aws-lambda-compat";
import { z } from "zod";
import { CatalogService, type PublicCatalogConfiguration } from "../../src/catalog/service.js";
import { AdminImportService } from "../../src/admin/import-service.js";
import {
  CloudSaveProfileService,
  cloudSaveProfileIdSchema,
  createCloudSaveProfileSchema,
  finalizeProfileUploadSchema,
  prepareProfileUploadSchema,
  renameCloudSaveProfileSchema,
  restoreProfileRevisionSchema
} from "../../src/cloud-save/profile-service.js";
import { deploymentControls, firebaseAdminEnv, stripeEnv } from "../../src/config/env.js";
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
import { claimWebsiteOrder, claimMatchingWebsitePurchases, discoverWebsitePurchases, websiteSubscriptionPortal, selectWebsiteMobilePlatform } from "../../src/providers/stripe/website-commerce.js";
import { syncGooglePlayOneTimeProduct, syncGooglePlaySubscription, googlePlaySubscriptionAdDetails, googlePlayOneTimeAdDetails } from "../../src/providers/google-play/service.js";
import { sha256 } from "../../src/infrastructure/ids.js";
import { claimAppleTransaction } from "../../src/providers/apple/service.js";
import { ACCOUNT_DELETION_CONFIRMATION, AccountDeletionService } from "../../src/account-deletion/service.js";
import {
  DeviceSignInService,
  invalidateDeviceSignInsForUid,
  requireCurrentDeviceSessionGeneration
} from "../../src/device-sign-in/service.js";
import { SecondPlatformRequestService } from "../../src/premium/second-platform-request-service.js";
import { AdminBootstrapService } from "../../src/admin/bootstrap-service.js";

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
const deviceApprovalSchema = z.object({
  userCode: z.string().trim().min(8).max(9),
  approvalSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional()
});
const adminBootstrapSchema = z.object({ confirmationPhrase: z.string().trim().min(1).max(320) });

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
  appCheckRecaptchaEnterpriseSiteKey?: string;
} {
  const parsed = z.object({
    APP_ENVIRONMENT: z.enum(["test", "production"]).default("test"),
    FIREBASE_WEB_API_KEY: z.string().min(20).max(256),
    FIREBASE_AUTH_DOMAIN: z.string().min(4).max(253),
    FIREBASE_PROJECT_ID: z.string().regex(/^[a-z][a-z0-9-]{4,29}$/),
    FIREBASE_STORAGE_BUCKET: z.string().min(4).max(253).optional(),
    FIREBASE_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY: z.string().min(20).max(256).optional()
  }).safeParse(process.env);
  if (!parsed.success) throw new HttpError(503, "Account login is not configured yet. Finish Firebase web setup at /setup/.");
  return {
    environment: parsed.data.APP_ENVIRONMENT,
    apiKey: parsed.data.FIREBASE_WEB_API_KEY,
    authDomain: parsed.data.FIREBASE_AUTH_DOMAIN,
    projectId: parsed.data.FIREBASE_PROJECT_ID,
    ...(parsed.data.FIREBASE_STORAGE_BUCKET ? { storageBucket: parsed.data.FIREBASE_STORAGE_BUCKET } : {}),
    ...(parsed.data.FIREBASE_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY
      ? { appCheckRecaptchaEnterpriseSiteKey: parsed.data.FIREBASE_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY }
      : {})
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
  if (path === "/v1/reviewer/mobile-link") return { action: "reviewer-mobile-link", limit: 10, windowSeconds: 10 * 60 };
  if (path === "/v1/checkout") return { action: "checkout", limit: 8, windowSeconds: 10 * 60 };
  if (path === "/v1/billing-portal") return { action: "billing-portal", limit: 10, windowSeconds: 10 * 60 };
  if (path === "/v1/legacy/claim") return { action: "legacy-claim", limit: 10, windowSeconds: 60 * 60 };
  if (path === "/v1/google-play/claim" || path === "/v1/apple/claim") return { action: "store-claim", limit: 30, windowSeconds: 10 * 60 };
  if (path === "/v1/me/revoke-sessions" || path.startsWith("/v1/me/deletion-")) return { action: "account-security", limit: 10, windowSeconds: 10 * 60 };
  if (path === "/v1/admin-bootstrap") return { action: "admin-bootstrap", limit: 3, windowSeconds: 60 * 60 };
  if (path.startsWith("/v1/me/second-platform-request")) return { action: "second-platform-request", limit: 6, windowSeconds: 60 * 60 };
  if (path.includes("/cloud-save-profiles")) {
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
  if (event.httpMethod === "OPTIONS") return { statusCode: 204 };
  if (event.httpMethod === "GET" && path === "/v1/config") {
    const publicFirebase = publicAccountFirebaseConfig();
    let accountApiReady = false;
    try { firebaseAdminEnv(); accountApiReady = true; } catch { accountApiReady = false; }
    let runtime: ReturnType<typeof stripeEnv> | undefined;
    try { runtime = stripeEnv(); } catch { runtime = undefined; }
    const fallbackCatalog: PublicCatalogConfiguration = {
      revision: 0,
      monthly: { unitAmount: MONTHLY_PRICE_USD_CENTS, currency: "USD", recurring: true },
      polyglot: { unitAmount: POLYGLOT_PERMANENT_PRICE_USD_CENTS, currency: "USD", recurring: false },
      premium: { unitAmount: PREMIUM_LIFETIME_PRICE_USD_CENTS, currency: "USD", recurring: false },
      regionalPrices: REGIONAL_PRICES
    };
    let catalog = fallbackCatalog;
    if (accountApiReady) {
      try {
        catalog = await new CatalogService(firestore()).getPublic(fallbackCatalog);
      } catch {
        // Authentication configuration must remain available during a Firestore or Stripe outage.
        catalog = fallbackCatalog;
      }
    }
    return json(200, {
      environment: publicFirebase.environment,
      accountApiReady,
      accountDeletionEnabled: deploymentControls().OUTBOX_PROCESSING_ENABLED && deploymentControls().ACCOUNT_DELETION_PROCESSING_ENABLED,
      checkoutEnabled: Boolean(runtime?.STRIPE_MUTATIONS_ENABLED),
      appCheckEnforced: deploymentControls().APP_CHECK_ENFORCEMENT_ENABLED,
      appCheckConfigured: Boolean(publicFirebase.appCheckRecaptchaEnterpriseSiteKey),
      adminBootstrapEnabled: deploymentControls().ADMIN_BOOTSTRAP_ENABLED,
      firebase: {
        apiKey: publicFirebase.apiKey,
        authDomain: publicFirebase.authDomain,
        projectId: publicFirebase.projectId,
        ...(publicFirebase.storageBucket ? { storageBucket: publicFirebase.storageBucket } : {})
      },
      ...(publicFirebase.appCheckRecaptchaEnterpriseSiteKey ? {
        appCheck: { recaptchaEnterpriseSiteKey: publicFirebase.appCheckRecaptchaEnterpriseSiteKey }
      } : {}),
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

  const reviewers = new ReviewerAccounts(db, firebaseAuth());
  await reviewers.recordLogin(user, now);
  if (event.httpMethod === "POST" && path === "/v1/reviewer/mobile-link") {
    return json(200, await reviewers.mobileLink(user, now));
  }

  if (event.httpMethod === "POST" && path === "/v1/admin-bootstrap") {
    if (!deploymentControls().ADMIN_BOOTSTRAP_ENABLED) throw new HttpError(503, "Initial administrator bootstrap is disabled.");
    const configuredEmail = z.string().email().safeParse(process.env.ADMIN_BOOTSTRAP_EMAIL);
    if (!configuredEmail.success) throw new HttpError(503, "Initial administrator bootstrap is not configured.");
    const parsed = adminBootstrapSchema.safeParse(parseJsonBody(event.body));
    if (!parsed.success) throw new HttpError(400, "Enter the exact administrator confirmation phrase.");
    return json(200, await new AdminBootstrapService(firebaseAuth(), db).grant({
      actor: user,
      configuredEmail: configuredEmail.data,
      confirmationPhrase: parsed.data.confirmationPhrase,
      now
    }));
  }

  if (path.startsWith("/v1/device-sign-in/")) {
    if (!deploymentControls().DEVICE_SIGN_IN_ENABLED) throw new HttpError(503, "PC/Mac device sign-in is disabled in this deployment.");
    const service = new DeviceSignInService(db, firebaseAuth());
    const approvalInput = event.httpMethod === "POST"
      ? deviceApprovalSchema.safeParse(parseJsonBody(event.body))
      : undefined;
    const userCode = event.httpMethod === "GET"
      ? event.queryStringParameters?.code
      : approvalInput?.data?.userCode;
    if (!userCode) throw new HttpError(400, "Enter the device code shown by WonderLang.");
    if (event.httpMethod === "GET" && path === "/v1/device-sign-in/preview") {
      return json(200, await service.preview({ uid: user.uid, userCode, now }));
    }
    if (event.httpMethod === "POST" && path === "/v1/device-sign-in/approve") {
      if (!user.auth_time || Math.floor(now.getTime() / 1000) - user.auth_time > 10 * 60) {
        throw new HttpError(401, "For security, sign out and sign in again before approving this device.");
      }
      return json(200, await service.approve({
        uid: user.uid,
        userCode,
        ...(approvalInput?.data?.approvalSecret ? { approvalSecret: approvalInput.data.approvalSecret } : {}),
        authTimeSeconds: user.auth_time,
        now
      }));
    }
    throw new HttpError(405, "Method Not Allowed");
  }

  if (event.httpMethod === "GET" && path === "/v1/me") {
    if (user.email && user.email_verified) {
      await new AdminImportService(db, firebaseAuth()).claimPendingForVerifiedUser({ uid: user.uid, email: user.email, now });
      await claimMatchingWebsitePurchases(store, user);
    }
    const [entitlements, discount, grants, authUser, cloudProfiles, stripeCustomerId, secondPlatformRequest] = await Promise.all([
      store.effectiveEntitlements(user.uid, now),
      store.legacyDiscountClaim(user.uid),
      store.grantsForUid(user.uid),
      firebaseAuth().getUser(user.uid),
      db.collection("cloudSaves").doc(user.uid).collection("profiles").get(),
      store.stripeCustomerId(user.uid),
      secondPlatformRequests.get(user.uid)
    ]);
    const cloudUpdates = cloudProfiles.docs
      .filter((doc) => Boolean(doc.data()?.currentRevision))
      .map((doc) => doc.data()?.updatedAt as string | undefined)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => Date.parse(b) - Date.parse(a));
    return json(200, {
      uid: user.uid,
      email: user.email ?? null,
      linkedLoginProviders: authUser.providerData.map((provider) => provider.providerId).filter((provider) => provider !== "firebase"),
      entitlements,
      subscription: summarizeSubscription(grants),
      subscriptions: grants.filter(g=>g.product==='mobile_full_monthly').map(g=>({...summarizeSubscription([g]),id:g.providerSubscriptionId??g.providerTransactionId,websiteCheckout:g.metadata?.websiteCheckout===true})),
      stripeBillingAvailable: Boolean(stripeCustomerId),
      secondMobilePlatformRequest: secondPlatformRequest,
      cloudSave: {
        enabled: entitlements.cloudSave,
        retainedWhenAccessEnds: true,
        profileCount: cloudProfiles.size,
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
    if (!deploymentControls().OUTBOX_PROCESSING_ENABLED || !deploymentControls().ACCOUNT_DELETION_PROCESSING_ENABLED) {
      throw new HttpError(503, "Automatic account deletion is unavailable. Email wonderlang.thegame@gmail.com to request deletion.");
    }
    return json(200, await new AccountDeletionService(db, firebaseAuth()).preview(user.uid, now));
  }

  if (event.httpMethod === "POST" && path === "/v1/me/deletion-commit") {
    if (!deploymentControls().OUTBOX_PROCESSING_ENABLED || !deploymentControls().ACCOUNT_DELETION_PROCESSING_ENABLED) {
      throw new HttpError(503, "Automatic account deletion is unavailable. Email wonderlang.thegame@gmail.com to request deletion.");
    }
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
    const input=z.object({subscriptionId:z.string().max(255).optional()}).strict().parse(parseJsonBody(event.body)||{});
    const grants=await store.grantsForUid(user.uid);
    const website=grants.find(g=>g.product==='mobile_full_monthly'&&g.metadata?.websiteCheckout===true&&g.providerSubscriptionId&&(!input.subscriptionId||g.providerSubscriptionId===input.subscriptionId));
    if(website?.providerSubscriptionId)return json(201,{url:await websiteSubscriptionPortal(store,user,website.providerSubscriptionId)});
    if(input.subscriptionId)throw new HttpError(404,'Website subscription not found.');
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

  if (event.httpMethod === "POST" && path === "/v1/website/claim") {
    const body = parseJsonBody(event.body) as Record<string, unknown>;
    if (!body || typeof body.sessionId !== "string" || (body.claimSecret !== undefined && typeof body.claimSecret !== "string")) throw new HttpError(400, "Invalid purchase reference.");
    return json(200, await claimWebsiteOrder(store, user, body.sessionId, body.claimSecret as string | undefined));
  }

  if(event.httpMethod === "POST" && path === "/v1/website/purchases")return json(200,{purchases:await discoverWebsitePurchases(store,user)});
  if(event.httpMethod === 'POST' && path === '/v1/website/mobile-platform'){
    const input=z.object({sessionId:z.string().regex(/^cs_[A-Za-z0-9_]+$/),platform:z.enum(['android','ios'])}).strict().parse(parseJsonBody(event.body));
    return json(200,await selectWebsiteMobilePlatform(store,user,input.sessionId,input.platform));
  }
  if(event.httpMethod === "POST" && path === "/v1/website/subscription-portal"){
    const parsed=z.object({subscriptionId:z.string().regex(/^sub_[A-Za-z0-9]+$/)}).strict().safeParse(parseJsonBody(event.body));
    if(!parsed.success)throw new HttpError(400,'Invalid subscription reference.');
    return json(201,{url:await websiteSubscriptionPortal(store,user,parsed.data.subscriptionId)});
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
    let adConversion;
    let adConversionPending = false;
    let adTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const details = parsed.data.kind === "subscription"
        ? googlePlaySubscriptionAdDetails(store, user.uid, parsed.data.purchaseToken, now)
        : googlePlayOneTimeAdDetails(store, user.uid, parsed.data.productId, parsed.data.purchaseToken, now);
      adConversion = await Promise.race([details,
        new Promise<undefined>(resolve => {adTimer = setTimeout(() => {adConversionPending = true; resolve(undefined);}, 2500);})]);
    } catch { adConversionPending = true; console.warn("Google Play conversion details unavailable; purchase access remains granted."); }
    finally { if (adTimer) clearTimeout(adTimer); }
    return json(200, { entitlements, adConversionStatus:adConversion ? "ready" : adConversionPending ? "pending" : "not_applicable", ...(adConversion ? {adConversion} : {}) });
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

  const cloudProfiles = new CloudSaveProfileService(db, firebaseStorage(), store);
  if (event.httpMethod === "GET" && path === "/v1/cloud-save-profiles") {
    return json(200, { profiles: await cloudProfiles.list(user.uid, now) });
  }
  if (event.httpMethod === "POST" && path === "/v1/cloud-save-profiles") {
    const parsed = createCloudSaveProfileSchema.safeParse(parseJsonBody(event.body));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join("; "));
    return json(201, await cloudProfiles.create(user.uid, parsed.data.name, now));
  }
  const profileRenameMatch = path.match(/^\/v1\/cloud-save-profiles\/([^/]+)\/rename$/);
  if (event.httpMethod === "POST" && profileRenameMatch?.[1]) {
    const profileId = cloudSaveProfileIdSchema.safeParse(profileRenameMatch[1]);
    const body = renameCloudSaveProfileSchema.safeParse(parseJsonBody(event.body));
    if (!profileId.success || !body.success) throw new HttpError(400, "A valid profile ID and name are required.");
    return json(200, await cloudProfiles.rename(user.uid, profileId.data, body.data.name, now));
  }
  const profilePrepareMatch = path.match(/^\/v1\/cloud-save-profiles\/([^/]+)\/prepare-upload$/);
  if (event.httpMethod === "POST" && profilePrepareMatch?.[1]) {
    const profileId = cloudSaveProfileIdSchema.safeParse(profilePrepareMatch[1]);
    const body = prepareProfileUploadSchema.safeParse(parseJsonBody(event.body));
    if (!profileId.success || !body.success) throw new HttpError(400, "Valid profile upload metadata is required.");
    return json(201, await cloudProfiles.prepareUpload(user.uid, profileId.data, body.data, now));
  }
  const profileFinalizeMatch = path.match(/^\/v1\/cloud-save-profiles\/([^/]+)\/finalize$/);
  if (event.httpMethod === "POST" && profileFinalizeMatch?.[1]) {
    const profileId = cloudSaveProfileIdSchema.safeParse(profileFinalizeMatch[1]);
    const parsed = finalizeProfileUploadSchema.safeParse(parseJsonBody(event.body));
    if (!profileId.success || !parsed.success) throw new HttpError(400, "A valid profile ID and upload ID are required.");
    return json(200, await cloudProfiles.finalizeUpload(user.uid, profileId.data, parsed.data.uploadId, now));
  }
  const profileRestoreMatch = path.match(/^\/v1\/cloud-save-profiles\/([^/]+)\/revisions\/([^/]+)\/restore$/);
  if (event.httpMethod === "POST" && profileRestoreMatch?.[1] && profileRestoreMatch[2]) {
    const profileId = cloudSaveProfileIdSchema.safeParse(profileRestoreMatch[1]);
    const revision = z.string().uuid().safeParse(profileRestoreMatch[2]);
    const body = restoreProfileRevisionSchema.safeParse(parseJsonBody(event.body));
    if (!profileId.success || !revision.success || !body.success) {
      throw new HttpError(400, "A valid profile, retained backup, and current revision are required.");
    }
    return json(200, await cloudProfiles.restoreRevision(
      user.uid,
      profileId.data,
      revision.data,
      body.data.expectedCurrentRevision,
      now
    ));
  }
  const profileDownloadMatch = path.match(/^\/v1\/cloud-save-profiles\/([^/]+)\/download$/);
  if (event.httpMethod === "GET" && profileDownloadMatch?.[1]) {
    const profileId = cloudSaveProfileIdSchema.safeParse(profileDownloadMatch[1]);
    if (!profileId.success) throw new HttpError(400, "A valid profile ID is required.");
    return json(200, await cloudProfiles.downloadUrl(user.uid, profileId.data, now));
  }
  const profileSummaryMatch = path.match(/^\/v1\/cloud-save-profiles\/([^/]+)\/summary$/);
  if (event.httpMethod === "GET" && profileSummaryMatch?.[1]) {
    const profileId = cloudSaveProfileIdSchema.safeParse(profileSummaryMatch[1]);
    if (!profileId.success) throw new HttpError(400, "A valid profile ID is required.");
    return json(200, await cloudProfiles.summary(user.uid, profileId.data, now));
  }
  return json(404, { error: "Not found" });
}

export const lambdaHandler: LambdaHandler = async (event) => {
  try { return withCors(event, await dispatch(event)); }
  catch (error) { return withCors(event, errorResponse(error)); }
};

export default withLambda(lambdaHandler);
