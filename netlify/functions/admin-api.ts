import type { Config } from "@netlify/functions";
import { withLambda } from "@netlify/aws-lambda-compat";
import type { HandlerEvent, HandlerResponse, LambdaHandler } from "@netlify/aws-lambda-compat";
import { z } from "zod";
import { AdminBillingService } from "../../src/admin/billing-service.js";
import { AdminCloudSaveService } from "../../src/admin/cloud-save-service.js";
import { LegacyKeyInventoryDiagnosticService } from "../../src/legacy/key-inventory-diagnostic.js";
import { AdminImportService } from "../../src/admin/import-service.js";
import { AdminOperationsService } from "../../src/admin/operations-service.js";
import { AdminProviderDiagnosticService } from "../../src/admin/provider-diagnostic-service.js";
import type { AdminActor } from "../../src/admin/audit.js";
import { deploymentControls } from "../../src/config/env.js";
import { requireAppCheck } from "../../src/http/app-check.js";
import { HttpError, requireAdmin, requireUser } from "../../src/http/auth.js";
import { apiAllowedOrigins, requestHeader, requireAllowedOrigin } from "../../src/http/origin.js";
import { consumeRateLimit, type RateLimitPolicy } from "../../src/http/rate-limit.js";
import { errorResponse, json, parseJsonBody } from "../../src/http/response.js";
import { firebaseAppCheck, firebaseAuth, firebaseStorage, firestore } from "../../src/infrastructure/firebase.js";

export const config: Config = {
  rateLimit: { windowSize: 60, windowLimit: 120, aggregateBy: ["domain", "ip"] }
};

const reason = z.string().trim().min(10).max(500);
const confirmation = z.string().trim().min(3).max(100);
const grantSchema = z.object({
  product: z.enum(["mobile_polyglot_permanent", "premium_lifetime_pass", "mobile_full_lifetime", "legacy_mobile_full", "legacy_chapter_1", "legacy_chapter_2", "legacy_chapter_3", "legacy_chapter_4"]),
  mobilePlatform: z.enum(["android", "ios"]).optional(),
  reason,
  endsAt: z.string().datetime().optional()
}).superRefine((value, context) => {
  if ((value.product === "mobile_polyglot_permanent" || value.product === "premium_lifetime_pass") && !value.mobilePlatform) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["mobilePlatform"], message: "Choose Android or iOS." });
  }
});
const pricePreviewSchema = z.object({
  kind: z.literal("premium"),
  unitAmount: z.number().int().min(1).max(100_000_000),
  currency: z.string().trim().length(3)
});
const commitSchema = z.object({ previewId: z.string().uuid(), confirmationPhrase: confirmation });
const refundPreviewSchema = z.object({
  uid: z.string().min(1).max(128),
  paymentIntentId: z.string().startsWith("pi_").max(255),
  amount: z.number().int().positive().optional(),
  reason: z.enum(["duplicate", "fraudulent", "requested_by_customer"]),
  note: reason
});
const importRowSchema = z.object({
  email: z.string().trim().email().max(320),
  kind: z.enum(["mobile_lifetime", "mobile_polyglot_permanent", "premium_lifetime_pass", "legacy_mobile_full", "legacy_chapter_1", "legacy_chapter_2", "legacy_chapter_3", "legacy_chapter_4", "desktop_discount"]),
  externalId: z.string().trim().min(1).max(200),
  mobilePlatform: z.enum(["android", "ios"]).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  note: z.string().trim().min(5).max(500)
}).superRefine((value, context) => {
  if ((value.kind === "mobile_polyglot_permanent" || value.kind === "premium_lifetime_pass") && !value.mobilePlatform) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["mobilePlatform"], message: "Choose Android or iOS." });
  }
});
const importPreviewSchema = z.object({ rows: z.array(importRowSchema).min(1).max(500) });
const reasonSchema = z.object({ reason });
const restoreProfileSchema = z.object({ reason, confirmationPhrase: confirmation });
const accessSchema = z.object({ disabled: z.boolean(), reason });
const repairEmailSchema = z.object({ email: z.string().trim().email().max(320), reason });

function routePath(event: HandlerEvent): string {
  return event.path.replace(/^\/\.netlify\/functions\/admin-api/, "").replace(/^\/admin-api/, "") || "/";
}

function secured(event: HandlerEvent, response: HandlerResponse): HandlerResponse {
  const origin = requestHeader(event.headers, "origin");
  const allowed = apiAllowedOrigins(false);
  return {
    ...response,
    headers: {
      ...(response.headers ?? {}),
      ...(origin && allowed.has(origin) ? { "access-control-allow-origin": origin } : {}),
      "access-control-allow-headers": "authorization, content-type, x-firebase-appcheck",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "cache-control": "no-store, max-age=0",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      vary: "Origin"
    }
  };
}

function adminRateLimitPolicy(method: string, path: string): RateLimitPolicy {
  if (path.endsWith("/commit")) return { action: "admin-commit", limit: 10, windowSeconds: 60 * 60 };
  if (method === "POST") return { action: "admin-write", limit: 30, windowSeconds: 10 * 60 };
  return { action: "admin-read", limit: 180, windowSeconds: 60 };
}

function body<T>(schema: z.ZodType<T>, event: HandlerEvent): T {
  const parsed = schema.safeParse(parseJsonBody(event.body));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join("; "));
  return parsed.data;
}

async function dispatch(event: HandlerEvent): Promise<HandlerResponse> {
  requireAllowedOrigin(requestHeader(event.headers, "origin"), apiAllowedOrigins(false));
  if (event.httpMethod === "OPTIONS") return { statusCode: 204 };
  const token = requireAdmin(await requireUser(requestHeader(event.headers, "authorization")));
  await requireAppCheck(
    requestHeader(event.headers, "x-firebase-appcheck"),
    firebaseAppCheck(),
    deploymentControls().APP_CHECK_ENFORCEMENT_ENABLED
  );
  const actor: AdminActor = { uid: token.uid, email: token.email! };
  const db = firestore();
  const path = routePath(event);
  const now = new Date();
  await consumeRateLimit({ db, namespace: "admin", subject: token.uid, policy: adminRateLimitPolicy(event.httpMethod, path), now });
  const operations = new AdminOperationsService(db, firebaseAuth());
  const billing = new AdminBillingService(db);
  const diagnostics = new AdminProviderDiagnosticService(db);
  const imports = new AdminImportService(db, firebaseAuth());
  const cloudSaves = new AdminCloudSaveService(db, firebaseStorage());
  const keyInventoryDiagnostic = new LegacyKeyInventoryDiagnosticService();

  if (event.httpMethod === "GET" && path === "/v1/session") {
    return json(200, {
      actor,
      providers: token.firebase?.sign_in_provider ? [token.firebase.sign_in_provider] : [],
      capabilities: ["customers", "grants", "prices", "refunds", "imports", "second_platform_requests", "cloud_save_download", "provider_diagnostics", "operations", "inventory", "audit"],
      controls: deploymentControls()
    });
  }
  if (event.httpMethod === "GET" && path === "/v1/overview") return json(200, await operations.overview());
  if (event.httpMethod === "GET" && path === "/v1/customers/search") {
    const query = event.queryStringParameters?.q;
    if (!query || query.length > 4096) throw new HttpError(400, "Enter an exact email, Firebase UID, Stripe ID, or provider transaction ID.");
    return json(200, await operations.findCustomer(query));
  }
  if (event.httpMethod === "GET" && path === "/v1/second-platform-requests") {
    return json(200, await operations.openSecondPlatformRequests());
  }
  const secondPlatformDecisionMatch = path.match(/^\/v1\/second-platform-requests\/([A-Za-z0-9_-]{1,128})\/(approve|decline)$/);
  if (event.httpMethod === "POST" && secondPlatformDecisionMatch?.[1] && secondPlatformDecisionMatch[2]) {
    const decision = secondPlatformDecisionMatch[2];
    const input = { actor, uid: secondPlatformDecisionMatch[1], ...body(reasonSchema, event), now };
    return json(200, decision === "approve"
      ? await operations.approveSecondPlatformRequest(input)
      : await operations.declineSecondPlatformRequest(input));
  }
  const customerMatch = path.match(/^\/v1\/customers\/([A-Za-z0-9_-]{1,128})$/);
  if (event.httpMethod === "GET" && customerMatch?.[1]) return json(200, await operations.customerDetail(customerMatch[1]));
  const grantCustomerMatch = path.match(/^\/v1\/customers\/([A-Za-z0-9_-]{1,128})\/grants$/);
  if (event.httpMethod === "POST" && grantCustomerMatch?.[1]) {
    const input = body(grantSchema, event);
    return json(201, await operations.createGrant({
      actor,
      uid: grantCustomerMatch[1],
      product: input.product,
      ...(input.mobilePlatform ? { mobilePlatform: input.mobilePlatform } : {}),
      reason: input.reason,
      ...(input.endsAt ? { endsAt: input.endsAt } : {}),
      now
    }));
  }
  const accessMatch = path.match(/^\/v1\/customers\/([A-Za-z0-9_-]{1,128})\/access$/);
  if (event.httpMethod === "POST" && accessMatch?.[1]) {
    return json(200, await operations.updateUserAccess({ actor, uid: accessMatch[1], ...body(accessSchema, event), now }));
  }
  const repairEmailMatch = path.match(/^\/v1\/customers\/([A-Za-z0-9_-]{1,128})\/repair-email$/);
  if (event.httpMethod === "POST" && repairEmailMatch?.[1]) {
    return json(200, await operations.repairCustomerEmail({
      actor,
      uid: repairEmailMatch[1],
      ...body(repairEmailSchema, event),
      now
    }));
  }
  const sessionsMatch = path.match(/^\/v1\/customers\/([A-Za-z0-9_-]{1,128})\/revoke-sessions$/);
  if (event.httpMethod === "POST" && sessionsMatch?.[1]) {
    await operations.revokeSessions({ actor, uid: sessionsMatch[1], ...body(reasonSchema, event), now });
    return json(200, { revoked: true });
  }
  const cancelDeletionMatch = path.match(/^\/v1\/customers\/([A-Za-z0-9_-]{1,128})\/cancel-deletion$/);
  if (event.httpMethod === "POST" && cancelDeletionMatch?.[1]) {
    return json(200, await operations.cancelAccountDeletion({ actor, uid: cancelDeletionMatch[1], ...body(reasonSchema, event), now }));
  }
  const cloudProfileDownloadMatch = path.match(/^\/v1\/customers\/([A-Za-z0-9_-]{1,128})\/cloud-save-profiles\/(default|[0-9a-f-]{36})\/download$/i);
  if (event.httpMethod === "POST" && cloudProfileDownloadMatch?.[1] && cloudProfileDownloadMatch[2]) {
    return json(200, await cloudSaves.createProfileDownload({
      actor,
      uid: cloudProfileDownloadMatch[1],
      profileId: cloudProfileDownloadMatch[2],
      ...body(reasonSchema, event),
      now
    }));
  }
  const cloudProfileRestoreMatch = path.match(/^\/v1\/customers\/([A-Za-z0-9_-]{1,128})\/cloud-save-profiles\/(default|[0-9a-f-]{36})\/revisions\/([0-9a-f-]{36})\/restore$/i);
  if (event.httpMethod === "POST" && cloudProfileRestoreMatch?.[1] && cloudProfileRestoreMatch[2] && cloudProfileRestoreMatch[3]) {
    return json(200, await cloudSaves.restoreProfileRevision({
      actor,
      uid: cloudProfileRestoreMatch[1],
      profileId: cloudProfileRestoreMatch[2],
      revision: cloudProfileRestoreMatch[3],
      ...body(restoreProfileSchema, event),
      now
    }));
  }
  const revokeGrantMatch = path.match(/^\/v1\/grants\/([A-Za-z0-9_-]{1,128})\/revoke$/);
  if (event.httpMethod === "POST" && revokeGrantMatch?.[1]) {
    return json(200, await operations.revokeAdminGrant({ actor, grantId: revokeGrantMatch[1], ...body(reasonSchema, event), now }));
  }
  if (event.httpMethod === "GET" && path === "/v1/catalog") return json(200, await billing.catalogStatus());
  if (event.httpMethod === "GET" && path === "/v1/diagnostics/stripe-catalog") {
    return json(200, await diagnostics.stripeCatalog(now));
  }
  if (event.httpMethod === "GET" && path === "/v1/diagnostics/google-play-catalog") {
    return json(200, await diagnostics.googlePlayCatalog(now));
  }
  if (event.httpMethod === "GET" && path === "/v1/diagnostics/firebase-authentication") {
    return json(200, await diagnostics.firebaseAuthentication(now));
  }
  if (event.httpMethod === "GET" && path === "/v1/diagnostics/apple-catalog") {
    return json(200, await diagnostics.appleCatalog(now));
  }
  if (event.httpMethod === "POST" && path === "/v1/catalog/price-preview") {
    return json(200, await billing.previewPriceChange({ actor, ...body(pricePreviewSchema, event), now }));
  }
  if (event.httpMethod === "POST" && path === "/v1/catalog/price-commit") {
    return json(200, await billing.commitPriceChange({ actor, ...body(commitSchema, event), now }));
  }
  if (event.httpMethod === "POST" && path === "/v1/refunds/preview") {
    const input = body(refundPreviewSchema, event);
    return json(200, await billing.previewRefund({
      actor,
      uid: input.uid,
      paymentIntentId: input.paymentIntentId,
      reason: input.reason,
      note: input.note,
      ...(input.amount ? { amount: input.amount } : {}),
      now
    }));
  }
  if (event.httpMethod === "POST" && path === "/v1/refunds/commit") {
    return json(200, await billing.commitRefund({ actor, ...body(commitSchema, event), now }));
  }
  if (event.httpMethod === "POST" && path === "/v1/imports/preview") {
    const input = body(importPreviewSchema, event);
    return json(200, await imports.preview({
      actor,
      // Zod has already stripped unknown properties. Preserve every validated
      // optional field, especially the platform required by Polyglot/Premium.
      rows: input.rows.map((row) => ({
        email: row.email,
        kind: row.kind,
        externalId: row.externalId,
        note: row.note,
        ...(row.mobilePlatform ? { mobilePlatform: row.mobilePlatform } : {}),
        ...(row.startsAt ? { startsAt: row.startsAt } : {}),
        ...(row.endsAt ? { endsAt: row.endsAt } : {})
      })),
      now
    }));
  }
  if (event.httpMethod === "POST" && path === "/v1/imports/commit") {
    return json(200, await imports.commit({ actor, ...body(commitSchema, event), now }));
  }
  if (event.httpMethod === "GET" && path === "/v1/operations") return json(200, await operations.operations());
  const retryMatch = path.match(/^\/v1\/outbox\/([A-Za-z0-9_-]{1,128})\/retry$/);
  if (event.httpMethod === "POST" && retryMatch?.[1]) {
    await operations.retryOutbox({ actor, jobId: retryMatch[1], ...body(reasonSchema, event), now });
    return json(200, { queued: true });
  }
  const cleanupRetryMatch = path.match(/^\/v1\/cloud-save-cleanup\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/retry$/i);
  if (event.httpMethod === "POST" && cleanupRetryMatch?.[1]) {
    await operations.retryCloudSaveCleanup({ actor, jobId: cleanupRetryMatch[1], ...body(reasonSchema, event), now });
    return json(200, { queued: true });
  }
  const releaseMatch = path.match(/^\/v1\/provider-events\/([A-Za-z0-9_-]{1,128})\/release$/);
  if (event.httpMethod === "POST" && releaseMatch?.[1]) {
    await operations.releaseProviderEvent({ actor, eventId: releaseMatch[1], ...body(reasonSchema, event), now });
    return json(200, { released: true });
  }
  if (event.httpMethod === "GET" && path === "/v1/inventory") return json(200, await operations.inventory());
  if (event.httpMethod === "GET" && path === "/v1/inventory/source-comparison") {
    return json(200, await keyInventoryDiagnostic.compare(await operations.inventorySummary(), now));
  }
  if (event.httpMethod === "GET" && path === "/v1/audit") {
    const limit = Number(event.queryStringParameters?.limit ?? 100);
    return json(200, await operations.audit(Number.isFinite(limit) ? limit : 100));
  }
  return json(404, { error: "Not found" });
}

export const lambdaHandler: LambdaHandler = async (event) => {
  try { return secured(event, await dispatch(event)); }
  catch (error) { return secured(event, errorResponse(error)); }
};

export default withLambda(lambdaHandler);
