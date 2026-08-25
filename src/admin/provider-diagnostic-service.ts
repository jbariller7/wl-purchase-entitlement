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
    const environment = googlePlayEnv();
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
