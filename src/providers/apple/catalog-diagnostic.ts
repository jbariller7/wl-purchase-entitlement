import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { z } from "zod";
import type { AppleCatalogDiagnosticEnvironment } from "../../config/env.js";

export interface AppStoreConnectApp {
  id: string;
  name: string;
  bundleId: string;
}

export interface AppStoreConnectSubscription {
  id: string;
  groupId: string;
  name: string;
  productId: string;
  state: string;
  subscriptionPeriod: string;
}

export interface AppStoreConnectIntroductoryOffer {
  duration: string;
  offerMode: string;
  numberOfPeriods: number;
  startDate: string | null;
  endDate: string | null;
}

export interface AppStoreConnectInAppPurchase {
  id: string;
  name: string;
  productId: string;
  state: string;
  inAppPurchaseType: string;
}

export interface AppStoreConnectCatalogReader {
  app(appId: string): Promise<AppStoreConnectApp>;
  subscriptions(appId: string): Promise<AppStoreConnectSubscription[]>;
  introductoryOffers(subscriptionId: string): Promise<AppStoreConnectIntroductoryOffer[]>;
  inAppPurchases(appId: string): Promise<AppStoreConnectInAppPurchase[]>;
  subscriptionUsPrice(subscriptionId: string, now: Date): Promise<string | null>;
  inAppPurchaseUsPrice(inAppPurchaseId: string, now: Date): Promise<string | null>;
}

export interface AppleCatalogDiagnosticCheck {
  id: string;
  label: string;
  resourceId: string;
  state: "passed" | "failed";
  issues: string[];
  details?: Record<string, string | number | boolean | string[] | null>;
}

export interface AppleCatalogDiagnostic {
  checkedAt: string;
  passed: boolean;
  readOnly: true;
  appId: string;
  bundleId: string;
  checks: AppleCatalogDiagnosticCheck[];
}

const historicalIdsSchema = z.array(z.string().trim().min(1)).min(1).max(20);
const sellableStates = new Set(["READY_TO_SUBMIT", "WAITING_FOR_REVIEW", "IN_REVIEW", "PENDING_BINARY_APPROVAL", "APPROVED"]);
const unusableHistoricalStates = new Set(["DELETED", "DELETION_IN_PROGRESS", "REJECTED"]);

function historicalProductIds(value: string): string[] {
  try {
    return [...new Set(historicalIdsSchema.parse(JSON.parse(value)))].sort();
  } catch {
    throw new Error("APPLE_HISTORICAL_PRODUCT_IDS must be a JSON string array.");
  }
}

function check(input: Omit<AppleCatalogDiagnosticCheck, "state">): AppleCatalogDiagnosticCheck {
  return { ...input, state: input.issues.length ? "failed" : "passed" };
}

function failedChecks(environment: AppleCatalogDiagnosticEnvironment): AppleCatalogDiagnosticCheck[] {
  return [
    ["app", "WonderLang App Store app", environment.APPLE_APP_ID],
    ["monthly", "Mobile Monthly subscription", environment.APPLE_MONTHLY_PRODUCT_ID],
    ["trial", "Mobile Monthly three-day trial", environment.APPLE_MONTHLY_PRODUCT_ID],
    ["polyglot", "Polyglot Permanent non-consumable", environment.APPLE_POLYGLOT_PRODUCT_ID],
    ["historical", "Historical chapter restore products", "restore-only chapters"]
  ].map(([id, label, resourceId]) => check({
    id: id!,
    label: label!,
    resourceId: resourceId!,
    issues: ["App Store Connect catalog could not be read with the configured server API credential."]
  }));
}

function normalizedPrice(value: string | null): string | null {
  if (value === null || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  return Number(value).toFixed(2);
}

function isCurrentOffer(offer: AppStoreConnectIntroductoryOffer, now: Date): boolean {
  const start = offer.startDate ? Date.parse(offer.startDate) : Number.NEGATIVE_INFINITY;
  const end = offer.endDate ? Date.parse(offer.endDate) : Number.POSITIVE_INFINITY;
  return Number.isFinite(start) || start === Number.NEGATIVE_INFINITY
    ? start <= now.getTime() && end >= now.getTime()
    : false;
}

export async function diagnoseAppleCatalog(input: {
  reader: AppStoreConnectCatalogReader;
  environment: AppleCatalogDiagnosticEnvironment;
  now: Date;
}): Promise<AppleCatalogDiagnostic> {
  const { environment, now } = input;
  try {
    const [app, subscriptions, inAppPurchases] = await Promise.all([
      input.reader.app(environment.APPLE_APP_ID),
      input.reader.subscriptions(environment.APPLE_APP_ID),
      input.reader.inAppPurchases(environment.APPLE_APP_ID)
    ]);
    const monthly = subscriptions.find((item) => item.productId === environment.APPLE_MONTHLY_PRODUCT_ID);
    const polyglot = inAppPurchases.find((item) => item.productId === environment.APPLE_POLYGLOT_PRODUCT_ID);
    const [offers, monthlyUsPrice, polyglotUsPrice] = await Promise.all([
      monthly ? input.reader.introductoryOffers(monthly.id) : Promise.resolve([]),
      monthly ? input.reader.subscriptionUsPrice(monthly.id, now) : Promise.resolve(null),
      polyglot ? input.reader.inAppPurchaseUsPrice(polyglot.id, now) : Promise.resolve(null)
    ]);
    const expectedHistoricalIds = historicalProductIds(environment.APPLE_HISTORICAL_PRODUCT_IDS);
    const historical = expectedHistoricalIds.map((productId) => inAppPurchases.find((item) => item.productId === productId));

    const appIssues: string[] = [];
    if (app.id !== environment.APPLE_APP_ID) appIssues.push("App Store Connect returned a different app resource.");
    if (app.bundleId !== environment.APPLE_BUNDLE_ID) appIssues.push("The App Store app bundle ID does not match the WonderLang iOS bundle ID.");

    const monthlyIssues: string[] = [];
    if (!monthly) monthlyIssues.push("Mobile Monthly is missing from the configured subscription group.");
    else {
      if (monthly.groupId !== environment.APPLE_SUBSCRIPTION_GROUP_ID) monthlyIssues.push("Mobile Monthly belongs to a different subscription group.");
      if (monthly.subscriptionPeriod !== "ONE_MONTH") monthlyIssues.push("Mobile Monthly is not configured as a one-month subscription.");
      if (!sellableStates.has(monthly.state)) monthlyIssues.push("Mobile Monthly is not in a sellable or review-ready state.");
      if (normalizedPrice(monthlyUsPrice) !== environment.APPLE_MONTHLY_USD_PRICE) monthlyIssues.push(`Mobile Monthly's current United States price is not USD ${environment.APPLE_MONTHLY_USD_PRICE}.`);
    }

    const trial = offers.find((offer) => offer.offerMode === "FREE_TRIAL" && offer.duration === "THREE_DAYS" && offer.numberOfPeriods === 1 && isCurrentOffer(offer, now));
    const trialIssues: string[] = [];
    if (!monthly) trialIssues.push("Mobile Monthly is missing, so its introductory offer cannot be verified.");
    else if (!trial) trialIssues.push("Mobile Monthly has no current free three-day introductory offer.");

    const polyglotIssues: string[] = [];
    if (!polyglot) polyglotIssues.push("Polyglot Permanent is missing from the app's in-app purchases.");
    else {
      if (polyglot.inAppPurchaseType !== "NON_CONSUMABLE") polyglotIssues.push("Polyglot Permanent is not a non-consumable purchase.");
      if (!sellableStates.has(polyglot.state)) polyglotIssues.push("Polyglot Permanent is not in a sellable or review-ready state.");
      if (normalizedPrice(polyglotUsPrice) !== environment.APPLE_POLYGLOT_USD_PRICE) polyglotIssues.push(`Polyglot Permanent's current United States price is not USD ${environment.APPLE_POLYGLOT_USD_PRICE}.`);
    }

    const missingHistorical = expectedHistoricalIds.filter((_productId, index) => !historical[index]);
    const unusableHistorical = historical.filter((item) => item && unusableHistoricalStates.has(item.state)).map((item) => item!.productId);
    const historicalIssues: string[] = [];
    if (missingHistorical.length) historicalIssues.push(`Missing historical restore products: ${missingHistorical.join(", ")}.`);
    if (unusableHistorical.length) historicalIssues.push(`Historical products are not restorable: ${unusableHistorical.join(", ")}.`);

    const checks = [
      check({
        id: "app",
        label: "WonderLang App Store app",
        resourceId: app.id,
        issues: appIssues,
        details: { name: app.name, bundleId: app.bundleId }
      }),
      check({
        id: "monthly",
        label: "Mobile Monthly subscription",
        resourceId: monthly?.productId ?? environment.APPLE_MONTHLY_PRODUCT_ID,
        issues: monthlyIssues,
        details: {
          subscriptionGroupId: monthly?.groupId ?? null,
          state: monthly?.state ?? "MISSING",
          period: monthly?.subscriptionPeriod ?? null,
          usPrice: normalizedPrice(monthlyUsPrice) ? `USD ${normalizedPrice(monthlyUsPrice)}` : null
        }
      }),
      check({
        id: "trial",
        label: "Mobile Monthly three-day trial",
        resourceId: monthly?.id ?? environment.APPLE_MONTHLY_PRODUCT_ID,
        issues: trialIssues,
        details: {
          active: Boolean(trial),
          duration: trial?.duration ?? null,
          mode: trial?.offerMode ?? null,
          numberOfPeriods: trial?.numberOfPeriods ?? 0
        }
      }),
      check({
        id: "polyglot",
        label: "Polyglot Permanent non-consumable",
        resourceId: polyglot?.productId ?? environment.APPLE_POLYGLOT_PRODUCT_ID,
        issues: polyglotIssues,
        details: {
          type: polyglot?.inAppPurchaseType ?? null,
          state: polyglot?.state ?? "MISSING",
          usPrice: normalizedPrice(polyglotUsPrice) ? `USD ${normalizedPrice(polyglotUsPrice)}` : null
        }
      }),
      check({
        id: "historical",
        label: "Historical chapter restore products",
        resourceId: "restore-only chapters",
        issues: historicalIssues,
        details: {
          expectedProductIds: expectedHistoricalIds,
          presentProductIds: historical.filter(Boolean).map((item) => item!.productId).sort(),
          newSalesRequired: false
        }
      })
    ];
    return {
      checkedAt: now.toISOString(),
      passed: checks.every((item) => item.state === "passed"),
      readOnly: true,
      appId: environment.APPLE_APP_ID,
      bundleId: environment.APPLE_BUNDLE_ID,
      checks
    };
  } catch {
    return {
      checkedAt: now.toISOString(),
      passed: false,
      readOnly: true,
      appId: environment.APPLE_APP_ID,
      bundleId: environment.APPLE_BUNDLE_ID,
      checks: failedChecks(environment)
    };
  }
}

interface JsonApiRelationship { data?: { id?: string; type?: string } | Array<{ id?: string; type?: string }> | null }
interface JsonApiResource {
  id?: string;
  type?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, JsonApiRelationship>;
}
interface JsonApiDocument {
  data?: JsonApiResource | JsonApiResource[];
  included?: JsonApiResource[];
}

function decodedPrivateKey(value: string): KeyObject {
  let decoded = value.trim();
  if (decoded.startsWith('"') && decoded.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(decoded);
      if (typeof parsed === "string") decoded = parsed.trim();
    } catch {
      // The generic validation error below deliberately hides the supplied value.
    }
  }
  decoded = decoded.replace(/\\+r\\+n/g, "\n").replace(/\\+n/g, "\n").replace(/\r\n?/g, "\n").trim();
  try {
    const key = createPrivateKey(decoded);
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("wrong key type");
    return key;
  } catch {
    throw new Error("Invalid App Store Connect private-key configuration.");
  }
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createConnectToken(environment: AppleCatalogDiagnosticEnvironment, key: KeyObject, nowMs: number): { token: string; expiresAt: number } {
  const issuedAt = Math.floor(nowMs / 1000);
  const encoded = `${encodeJson({ alg: "ES256", kid: environment.APPLE_KEY_ID, typ: "JWT" })}.${encodeJson({
    iss: environment.APPLE_ISSUER_ID,
    iat: issuedAt,
    exp: issuedAt + 120,
    aud: "appstoreconnect-v1"
  })}`;
  const signature = sign("sha256", Buffer.from(encoded), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return { token: `${encoded}.${signature}`, expiresAt: nowMs + 105_000 };
}

function resources(document: JsonApiDocument): JsonApiResource[] {
  if (Array.isArray(document.data)) return document.data;
  return document.data ? [document.data] : [];
}

function stringAttribute(resource: JsonApiResource, name: string): string {
  const value = resource.attributes?.[name];
  return typeof value === "string" ? value : "";
}

function relatedIds(resource: JsonApiResource, name: string): string[] {
  const data = resource.relationships?.[name]?.data;
  if (!data) return [];
  return (Array.isArray(data) ? data : [data]).map((item) => item.id ?? "").filter(Boolean);
}

function activePrice(document: JsonApiDocument, relationshipName: string, pointType: string, now: Date): string | null {
  const points = new Map((document.included ?? [])
    .filter((resource) => resource.type === pointType)
    .map((resource) => [resource.id ?? "", stringAttribute(resource, "customerPrice")]));
  const candidates = resources(document).filter((resource) => {
    const start = stringAttribute(resource, "startDate");
    const end = stringAttribute(resource, "endDate");
    return (!start || Date.parse(start) <= now.getTime()) && (!end || Date.parse(end) >= now.getTime());
  });
  for (const candidate of candidates.reverse()) {
    const pointId = relatedIds(candidate, relationshipName)[0];
    const price = pointId ? points.get(pointId) : undefined;
    if (price) return price;
  }
  return null;
}

export function createAppStoreConnectCatalogReader(environment: AppleCatalogDiagnosticEnvironment): AppStoreConnectCatalogReader {
  const key = decodedPrivateKey(environment.APPLE_PRIVATE_KEY);
  let cachedToken: { token: string; expiresAt: number } | undefined;
  async function request(path: string): Promise<JsonApiDocument> {
    const nowMs = Date.now();
    if (!cachedToken || cachedToken.expiresAt <= nowMs) cachedToken = createConnectToken(environment, key, nowMs);
    const response = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${cachedToken.token}` },
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new Error("App Store Connect request failed.");
    return await response.json() as JsonApiDocument;
  }
  return {
    async app(appId) {
      const document = await request(`/v1/apps/${encodeURIComponent(appId)}?fields%5Bapps%5D=name,bundleId`);
      const resource = resources(document)[0];
      if (!resource) throw new Error("App Store app is missing.");
      return { id: resource.id ?? "", name: stringAttribute(resource, "name"), bundleId: stringAttribute(resource, "bundleId") };
    },
    async subscriptions(appId) {
      const document = await request(`/v1/apps/${encodeURIComponent(appId)}/subscriptionGroups?include=subscriptions&fields%5BsubscriptionGroups%5D=referenceName,subscriptions&fields%5Bsubscriptions%5D=name,productId,state,subscriptionPeriod&limit=200&limit%5Bsubscriptions%5D=50`);
      const groupBySubscription = new Map<string, string>();
      for (const group of resources(document)) for (const id of relatedIds(group, "subscriptions")) groupBySubscription.set(id, group.id ?? "");
      return (document.included ?? []).filter((resource) => resource.type === "subscriptions").map((resource) => ({
        id: resource.id ?? "",
        groupId: groupBySubscription.get(resource.id ?? "") ?? "",
        name: stringAttribute(resource, "name"),
        productId: stringAttribute(resource, "productId"),
        state: stringAttribute(resource, "state"),
        subscriptionPeriod: stringAttribute(resource, "subscriptionPeriod")
      }));
    },
    async introductoryOffers(subscriptionId) {
      const document = await request(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}/introductoryOffers?fields%5BsubscriptionIntroductoryOffers%5D=startDate,endDate,duration,offerMode,numberOfPeriods&limit=200`);
      return resources(document).map((resource) => ({
        duration: stringAttribute(resource, "duration"),
        offerMode: stringAttribute(resource, "offerMode"),
        numberOfPeriods: Number(resource.attributes?.numberOfPeriods ?? 0),
        startDate: stringAttribute(resource, "startDate") || null,
        endDate: stringAttribute(resource, "endDate") || null
      }));
    },
    async inAppPurchases(appId) {
      const document = await request(`/v1/apps/${encodeURIComponent(appId)}/inAppPurchasesV2?fields%5BinAppPurchases%5D=name,productId,inAppPurchaseType,state&limit=200`);
      return resources(document).map((resource) => ({
        id: resource.id ?? "",
        name: stringAttribute(resource, "name"),
        productId: stringAttribute(resource, "productId"),
        state: stringAttribute(resource, "state"),
        inAppPurchaseType: stringAttribute(resource, "inAppPurchaseType")
      }));
    },
    async subscriptionUsPrice(subscriptionId, now) {
      const document = await request(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}/prices?filter%5Bterritory%5D=USA&include=subscriptionPricePoint,territory&fields%5BsubscriptionPricePoints%5D=customerPrice&fields%5Bterritories%5D=currency&limit=200`);
      return activePrice(document, "subscriptionPricePoint", "subscriptionPricePoints", now);
    },
    async inAppPurchaseUsPrice(inAppPurchaseId, now) {
      const document = await request(`/v1/inAppPurchasePriceSchedules/${encodeURIComponent(inAppPurchaseId)}/manualPrices?filter%5Bterritory%5D=USA&include=inAppPurchasePricePoint,territory&fields%5BinAppPurchasePricePoints%5D=customerPrice&fields%5Bterritories%5D=currency&limit=200`);
      return activePrice(document, "inAppPurchasePricePoint", "inAppPurchasePricePoints", now);
    }
  };
}
