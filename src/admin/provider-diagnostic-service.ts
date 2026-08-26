import { CatalogService } from "../catalog/service.js";
import { appleCatalogDiagnosticEnv, deploymentControls, firebaseAuthDiagnosticEnv, googlePlayEnv, stripeEnv } from "../config/env.js";
import { createAppStoreConnectCatalogReader, diagnoseAppleCatalog } from "../providers/apple/catalog-diagnostic.js";
import { createFirebaseAuthenticationConfigurationReader, diagnoseFirebaseAuthentication } from "../providers/firebase-auth/configuration-diagnostic.js";
import { createGooglePlayCatalogReader, diagnoseGooglePlayCatalog } from "../providers/google-play/catalog-diagnostic.js";
import { diagnoseStripeCatalog } from "../providers/stripe/catalog-diagnostic.js";
import { stripeClient } from "../providers/stripe/client.js";

export class AdminProviderDiagnosticService {
  private readonly catalog: CatalogService;

  constructor(db: Firestore) {
    this.catalog = new CatalogService(db);
  }

  async stripeCatalog(now: Date): Promise<Record<string, unknown>> {
    return diagnoseStripeCatalog({
      client: stripeClient(),
      catalog: await this.catalog.get(),
      environment: stripeEnv(),
      controls: deploymentControls(),
      now
    }) as unknown as Record<string, unknown>;
  }

  async googlePlayCatalog(now: Date): Promise<Record<string, unknown>> {
    let environment: ReturnType<typeof googlePlayEnv>;
    try {
      environment = googlePlayEnv();
    } catch {
      const controls = deploymentControls();
      return {
        checkedAt: now.toISOString(),
        passed: false,
        readOnly: true,
        packageName: process.env.GOOGLE_PLAY_PACKAGE_NAME?.trim() || "com.wonderlang.app",
        rolloutPhase: process.env.GOOGLE_PLAY_POLYGLOT_ROLLOUT_PHASE === "compatible_update_live"
          ? "compatible_update_live"
          : "legacy_live_new_draft",
        webhookProcessingEnabled: controls.GOOGLE_PLAY_WEBHOOKS_ENABLED,
        checks: [{
          id: "provider-credentials",
          label: "Dedicated Google Play service account",
          resourceId: "Netlify environment",
          state: "failed",
          issues: ["Dedicated Google Play credentials are not installed in this test deployment."],
          details: {
            configured: false,
            requiredAccess: "View app information, financial data, orders and subscriptions",
            webhookProcessingEnabled: controls.GOOGLE_PLAY_WEBHOOKS_ENABLED
          }
        }]
      };
    }
    return diagnoseGooglePlayCatalog({
      reader: createGooglePlayCatalogReader(environment),
      environment,
      controls: deploymentControls(),
      now
    }) as unknown as Record<string, unknown>;
  }

  async firebaseAuthentication(now: Date): Promise<Record<string, unknown>> {
    const environment = firebaseAuthDiagnosticEnv();
    return diagnoseFirebaseAuthentication({
      reader: createFirebaseAuthenticationConfigurationReader(environment),
      environment,
      now
    }) as unknown as Record<string, unknown>;
  }

  async appleCatalog(now: Date): Promise<Record<string, unknown>> {
    const environment = appleCatalogDiagnosticEnv();
    return diagnoseAppleCatalog({
      reader: createAppStoreConnectCatalogReader(environment),
      environment,
      now
    }) as unknown as Record<string, unknown>;
  }
}
import type { Firestore } from "firebase-admin/firestore";
