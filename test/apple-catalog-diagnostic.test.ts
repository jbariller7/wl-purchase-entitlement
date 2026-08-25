import { generateKeyPairSync, verify } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppleCatalogDiagnosticEnvironment } from "../src/config/env.js";
import {
  createAppStoreConnectCatalogReader,
  diagnoseAppleCatalog,
  type AppStoreConnectCatalogReader,
  type AppStoreConnectInAppPurchase,
  type AppStoreConnectSubscription
} from "../src/providers/apple/catalog-diagnostic.js";

function environment(overrides: Partial<AppleCatalogDiagnosticEnvironment> = {}): AppleCatalogDiagnosticEnvironment {
  return {
    APPLE_BUNDLE_ID: "com.wonderlang.app",
    APPLE_APP_ID: "6780447024",
    APPLE_ISSUER_ID: "test-issuer",
    APPLE_KEY_ID: "TESTKEY123",
    APPLE_PRIVATE_KEY: "test-only",
    APPLE_MONTHLY_PRODUCT_ID: "wonderlangmonthly",
    APPLE_POLYGLOT_PRODUCT_ID: "wonderlangfull",
    APPLE_SUBSCRIPTION_GROUP_ID: "22331966",
    APPLE_HISTORICAL_PRODUCT_IDS: '["wonderlangch1","wonderlangch2","wonderlangch3","wonderlangch4"]',
    APPLE_MONTHLY_USD_PRICE: "6.99",
    APPLE_POLYGLOT_USD_PRICE: "31.99",
    ...overrides
  };
}

function monthly(overrides: Partial<AppStoreConnectSubscription> = {}): AppStoreConnectSubscription {
  return {
    id: "6804702003",
    groupId: "22331966",
    name: "Mobile Monthly",
    productId: "wonderlangmonthly",
    state: "READY_TO_SUBMIT",
    subscriptionPeriod: "ONE_MONTH",
    ...overrides
  };
}

function purchase(productId: string, overrides: Partial<AppStoreConnectInAppPurchase> = {}): AppStoreConnectInAppPurchase {
  return {
    id: `iap-${productId}`,
    name: productId,
    productId,
    state: "APPROVED",
    inAppPurchaseType: "NON_CONSUMABLE",
    ...overrides
  };
}

function reader(overrides: Partial<AppStoreConnectCatalogReader> = {}): AppStoreConnectCatalogReader {
  const purchases = ["wonderlangfull", "wonderlangch1", "wonderlangch2", "wonderlangch3", "wonderlangch4"].map((id) => purchase(id));
  return {
    async app() { return { id: "6780447024", name: "WonderLang", bundleId: "com.wonderlang.app" }; },
    async subscriptions() { return [monthly()]; },
    async introductoryOffers() { return [{ duration: "THREE_DAYS", offerMode: "FREE_TRIAL", numberOfPeriods: 1, startDate: "2026-08-24", endDate: null }]; },
    async inAppPurchases() { return purchases; },
    async subscriptionUsPrice() { return "6.99"; },
    async inAppPurchaseUsPrice() { return "31.99"; },
    ...overrides
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("read-only App Store Connect catalog diagnostic", () => {
  it("validates the app, Monthly, three-day trial, Polyglot and all restore-only chapter products", async () => {
    const result = await diagnoseAppleCatalog({
      reader: reader(),
      environment: environment(),
      now: new Date("2026-08-26T00:00:00.000Z")
    });

    expect(result).toMatchObject({
      checkedAt: "2026-08-26T00:00:00.000Z",
      passed: true,
      readOnly: true,
      appId: "6780447024",
      bundleId: "com.wonderlang.app"
    });
    expect(result.checks).toHaveLength(5);
    expect(result.checks.every((item) => item.state === "passed")).toBe(true);
    expect(result.checks.find((item) => item.id === "monthly")?.details).toMatchObject({ usPrice: "USD 6.99", period: "ONE_MONTH" });
    expect(result.checks.find((item) => item.id === "polyglot")?.details).toMatchObject({ usPrice: "USD 31.99", type: "NON_CONSUMABLE" });
    expect(result.checks.find((item) => item.id === "historical")?.details).toMatchObject({ newSalesRequired: false });
    expect(JSON.stringify(result)).not.toContain("test-issuer");
    expect(JSON.stringify(result)).not.toContain("TESTKEY123");
    expect(JSON.stringify(result)).not.toContain("test-only");
  });

  it("reports incomplete or unsafe catalog states without weakening historical restore policy", async () => {
    const result = await diagnoseAppleCatalog({
      reader: reader({
        async app() { return { id: "6780447024", name: "Wrong", bundleId: "wrong.bundle" }; },
        async subscriptions() { return [monthly({ groupId: "wrong-group", state: "MISSING_METADATA", subscriptionPeriod: "ONE_YEAR" })]; },
        async introductoryOffers() { return []; },
        async inAppPurchases() {
          return [
            purchase("wonderlangfull", { state: "REJECTED", inAppPurchaseType: "CONSUMABLE" }),
            purchase("wonderlangch1", { state: "DEVELOPER_REMOVED_FROM_SALE" }),
            purchase("wonderlangch3", { state: "REJECTED" }),
            purchase("wonderlangch4")
          ];
        },
        async subscriptionUsPrice() { return "7.99"; },
        async inAppPurchaseUsPrice() { return "32.99"; }
      }),
      environment: environment(),
      now: new Date("2026-08-26T00:00:00.000Z")
    });

    expect(result.passed).toBe(false);
    expect(result.checks.find((item) => item.id === "app")?.issues).toHaveLength(1);
    expect(result.checks.find((item) => item.id === "monthly")?.issues).toHaveLength(4);
    expect(result.checks.find((item) => item.id === "trial")?.issues).toHaveLength(1);
    expect(result.checks.find((item) => item.id === "polyglot")?.issues).toHaveLength(3);
    expect(result.checks.find((item) => item.id === "historical")?.issues).toEqual([
      "Missing historical restore products: wonderlangch2.",
      "Historical products are not restorable: wonderlangch3."
    ]);
  });

  it("sanitizes App Store Connect permission, token and provider failures", async () => {
    const result = await diagnoseAppleCatalog({
      reader: reader({
        async app() { throw new Error("raw Apple response and bearer token"); }
      }),
      environment: environment(),
      now: new Date("2026-08-26T00:00:00.000Z")
    });

    expect(result.passed).toBe(false);
    expect(result.checks).toHaveLength(5);
    expect(result.checks.every((item) => item.issues[0] === "App Store Connect catalog could not be read with the configured server API credential.")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("raw Apple response");
    expect(JSON.stringify(result)).not.toContain("bearer token");
  });

  it("uses a two-minute ES256 bearer token and an exact GET-only App Store Connect request", async () => {
    const wrongCurve = generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(() => createAppStoreConnectCatalogReader(environment({ APPLE_PRIVATE_KEY: wrongCurve }))).toThrow("Invalid App Store Connect private-key configuration.");
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      data: { type: "apps", id: "6780447024", attributes: { name: "WonderLang", bundleId: "com.wonderlang.app" } }
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const catalogReader = createAppStoreConnectCatalogReader(environment({ APPLE_PRIVATE_KEY: privatePem }));
    await expect(catalogReader.app("6780447024")).resolves.toMatchObject({ bundleId: "com.wonderlang.app" });

    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.appstoreconnect.apple.com/v1/apps/6780447024?fields%5Bapps%5D=name,bundleId");
    expect(request).toMatchObject({ method: "GET" });
    const authorization = new Headers(request?.headers).get("Authorization")!;
    expect(authorization.startsWith("Bearer ")).toBe(true);
    const token = authorization.slice("Bearer ".length);
    const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
    const header = JSON.parse(Buffer.from(encodedHeader!, "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(encodedPayload!, "base64url").toString("utf8"));
    expect(header).toEqual({ alg: "ES256", kid: "TESTKEY123", typ: "JWT" });
    expect(payload).toMatchObject({ iss: "test-issuer", aud: "appstoreconnect-v1" });
    expect(payload.exp - payload.iat).toBe(120);
    expect(verify("sha256", Buffer.from(`${encodedHeader}.${encodedPayload}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(encodedSignature!, "base64url"))).toBe(true);
  });
});
