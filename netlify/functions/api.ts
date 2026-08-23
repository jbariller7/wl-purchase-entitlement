import type { Handler, HandlerEvent, HandlerResponse } from "@netlify/functions";
import { z } from "zod";
import { CatalogService } from "../../src/catalog/service.js";
import { AdminImportService } from "../../src/admin/import-service.js";
import { CloudSaveService, finalizeUploadSchema, prepareUploadSchema } from "../../src/cloud-save/service.js";
import { env } from "../../src/config/env.js";
import { MONTHLY_PRICE_USD_CENTS } from "../../src/domain/catalog.js";
import { HttpError, requireUser } from "../../src/http/auth.js";
import { errorResponse, json, parseJsonBody } from "../../src/http/response.js";
import { EntitlementStore } from "../../src/infrastructure/entitlement-store.js";
import { firebaseAuth, firebaseStorage, firestore } from "../../src/infrastructure/firebase.js";
import { checkoutRequestSchema, createBillingPortal, createCheckout } from "../../src/providers/stripe/checkout-service.js";
import { claimHistoricalDesktopOrder } from "../../src/providers/stripe/legacy-claim-service.js";
import { syncGooglePlayOneTimeProduct, syncGooglePlaySubscription } from "../../src/providers/google-play/service.js";
import { sha256 } from "../../src/infrastructure/ids.js";
import { claimAppleTransaction } from "../../src/providers/apple/service.js";

const legacyClaimSchema = z.object({ checkoutSessionId: z.string().min(4).max(255) });
const googlePlayClaimSchema = z.object({
  kind: z.enum(["subscription", "one_time"]),
  productId: z.string().min(1).max(255),
  purchaseToken: z.string().min(16).max(4096)
});
const appleClaimSchema = z.object({ signedTransactionInfo: z.string().min(20).max(100_000) });

function routePath(event: HandlerEvent): string {
  return event.path
    .replace(/^\/\.netlify\/functions\/api/, "")
    .replace(/^\/api/, "") || "/";
}

function clientIp(event: HandlerEvent): string | undefined {
  const direct = event.headers["x-nf-client-connection-ip"];
  if (direct) return direct;
  return event.headers["x-forwarded-for"]?.split(",")[0]?.trim();
}

function withCors(event: HandlerEvent, response: HandlerResponse): HandlerResponse {
  const origin = event.headers.origin;
  const allowed = new Set([
    ...(process.env.PUBLIC_APP_ORIGIN ? [process.env.PUBLIC_APP_ORIGIN] : []),
    "https://www.wonderlang.net"
  ]);
  return {
    ...response,
    headers: {
      ...(response.headers ?? {}),
      ...(origin && allowed.has(origin) ? { "access-control-allow-origin": origin } : {}),
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      vary: "Origin"
    }
  };
}

async function dispatch(event: HandlerEvent): Promise<HandlerResponse> {
  const path = routePath(event);
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
      firebase: {
        apiKey: runtime.FIREBASE_WEB_API_KEY,
        authDomain: runtime.FIREBASE_AUTH_DOMAIN,
        projectId: runtime.FIREBASE_PROJECT_ID,
        storageBucket: runtime.FIREBASE_STORAGE_BUCKET
      },
      catalog: {
        revision: catalog.revision,
        monthly: catalog.monthly,
        lifetime: catalog.lifetime,
        monthlyUsdCents: catalog.monthly.currency === "USD" ? catalog.monthly.unitAmount : MONTHLY_PRICE_USD_CENTS,
        monthlyIncludes: ["all_chapters", "all_languages", "cloud_save"],
        lifetimeIncludes: ["all_chapters", "all_languages", "cloud_save"]
      }
    });
  }

  const user = await requireUser(event.headers.authorization);
  const db = firestore();
  const store = new EntitlementStore(db);
  const now = new Date();

  if (event.httpMethod === "GET" && path === "/v1/me") {
    if (user.email && user.email_verified) {
      await new AdminImportService(db, firebaseAuth()).claimPendingForVerifiedUser({ uid: user.uid, email: user.email, now });
    }
    const [entitlements, discount] = await Promise.all([
      store.effectiveEntitlements(user.uid, now),
      store.legacyDiscountClaim(user.uid)
    ]);
    return json(200, {
      uid: user.uid,
      email: user.email ?? null,
      entitlements,
      legacyLifetimeDiscount: {
        eligible: Boolean(discount?.verifiedDesktopTransactionIds.length && !discount.redeemedAt),
        redeemedAt: discount?.redeemedAt ?? null
      }
    });
  }

  if (event.httpMethod === "GET" && path === "/v1/store-account-token") {
    return json(200, { storeAccountToken: await store.storeAccountToken(user.uid, now) });
  }

  if (event.httpMethod === "POST" && path === "/v1/checkout") {
    const parsed = checkoutRequestSchema.safeParse(parseJsonBody(event.body));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join("; "));
    const ipAddress = clientIp(event);
    const userAgent = event.headers["user-agent"];
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

export const handler: Handler = async (event) => {
  try { return withCors(event, await dispatch(event)); }
  catch (error) { return withCors(event, errorResponse(error)); }
};
