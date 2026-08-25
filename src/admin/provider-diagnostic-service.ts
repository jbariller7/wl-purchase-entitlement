import { CatalogService } from "../catalog/service.js";
import { deploymentControls, googlePlayEnv, stripeEnv } from "../config/env.js";
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
}
import type { Firestore } from "firebase-admin/firestore";
