import type { Config } from "@netlify/functions";
import { withLambda } from "@netlify/aws-lambda-compat";
import type { HandlerEvent, HandlerResponse, LambdaHandler } from "@netlify/aws-lambda-compat";
import { z } from "zod";
import { CatalogService } from "../../src/catalog/service.js";
import { AdminImportService } from "../../src/admin/import-service.js";
import { CloudSaveService, finalizeUploadSchema, prepareUploadSchema } from "../../src/cloud-save/service.js";
import { deploymentControls, env } from "../../src/config/env.js";
import { MONTHLY_PRICE_USD_CENTS, POLYGLOT_PERMANENT_PRICE_USD_CENTS, PREMIUM_LIFETIME_PRICE_USD_CENTS, STRIPE_SUBSCRIPTION_TRIAL_DAYS } from "../../src/domain/catalog.js";
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

function withCors(event: HandlerEvent, response: HandlerResponse): HandlerResponse {
  const origin = requestHeader(event.headers, "origin");
  const allowed = apiAllowedOrigins(true);
  return {
    ...response,
    headers: {
      ...(response.headers ?? {}),
      ...(origin && allowed.has(origin) ? { "access-control-allow-origin": origin } : {}),
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
  requireAllowedOrigin(requestHeader(event.headers, "origin"), apiAllowedOrigins(true));
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, body: "" };
  if (event.httpMethod === "GET" && path === "/v1/config") {
    let runtime: ReturnType<typeof env>;
    try { runtime = env(); }
    catch {
      throw new HttpError(503, "Account testing is not configured yet. Finish the Firebase and Stripe test setup at /setup/.");
    }
    const catalog = await new CatalogService(firestore()).get();
    return json(200, {
      environment: runtime.APP_ENVIRONMENT,
      checkoutEnabled: runtime.STRIPE_MUTATIONS_ENABLED,
      appCheckEnforced: runtime.APP_CHECK_ENFORCEMENT_ENABLED,
      firebase: {
        apiKey: runtime.FIREBASE_WEB_API_KEY,
        authDomain: runtime.FIREBASE_AUTH_DOMAIN,
        projectId: runtime.FIREBASE_PROJECT_ID,
        storageBucket: runtime.FIREBASE_STORAGE_BUCKET
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

  const user = await requireUser(requestHeader(event.headers, "authorization"));
  await requireAppCheck(
    requestHeader(event.headers, "x-firebase-appcheck"),
    firebaseAppCheck(),
    deploymentControls().APP_CHECK_ENFORCEMENT_ENABLED
  );
  const db = firestore();
  const store = new EntitlementStore(db);
  const now = new Date();
  await consumeRateLimit({
    db,
    namespace: "api",
    subject: user.uid,
    policy: userRateLimitPolicy(event.httpMethod, path),
    now
  });

  if (event.httpMethod === "GET" && path === "/v1/me") {
    if (user.email && user.email_verified) {
      await new AdminImportService(db, firebaseAuth()).claimPendingForVerifiedUser({ uid: user.uid, email: user.email, now });
    }
    const [entitlements, discount, grants, authUser, cloudSlots] = await Promise.all([
      store.effectiveEntitlements(user.uid, now),
      store.legacyDiscountClaim(user.uid),
      store.grantsForUid(user.uid),
      firebaseAuth().getUser(user.uid),
      db.collection("cloudSaves").doc(user.uid).collection("slots").get()
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

  if (event.httpMethod === "POST" && path === "/v1/me/revoke-sessions") {
    const parsed = revokeSessionsSchema.safeParse(parseJsonBody(event.body));
    if (!parsed.success) throw new HttpError(400, "Type SIGN OUT ALL DEVICES to confirm.");
    await firebaseAuth().revokeRefreshTokens(user.uid);
    return json(200, { revoked: true });
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
  const downloadMatch = path.match(/^\/v1\/cloud-saves\/([a-zA-Z0-9_-]{1,64})$/);
  if (event.httpMethod === "GET" && downloadMatch?.[1]) {
    return json(200, await cloudSave.downloadUrl(user.uid, downloadMatch[1], now));
  }
  return json(404, { error: "Not found" });
}

export const lambdaHandler: LambdaHandler = async (event) => {
  try { return withCors(event, await dispatch(event)); }
  catch (error) { return withCors(event, errorResponse(error)); }
};

export default withLambda(lambdaHandler);
