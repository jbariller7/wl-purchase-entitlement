import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { AdminProviderDiagnosticService } from "../src/admin/provider-diagnostic-service.js";
import { resetEnvironmentForTests } from "../src/config/env.js";

const original = { ...process.env };

beforeEach(() => {
  process.env = {
    ...original,
    APP_ENVIRONMENT: "test",
    GOOGLE_PLAY_WEBHOOKS_ENABLED: "false",
    GOOGLE_PLAY_PACKAGE_NAME: "com.wonderlang.app",
    GOOGLE_PLAY_POLYGLOT_ROLLOUT_PHASE: "legacy_live_new_draft"
  };
  delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_PLAY_PRIVATE_KEY;
  resetEnvironmentForTests();
});

afterEach(() => {
  process.env = { ...original };
  resetEnvironmentForTests();
});

describe("administrator provider diagnostic readiness", () => {
  it("reports missing dedicated Google Play credentials without a generic server error", async () => {
    const service = new AdminProviderDiagnosticService({} as Firestore);
    const result = await service.googlePlayCatalog(new Date("2026-08-27T00:00:00.000Z"));

    expect(result).toMatchObject({
      checkedAt: "2026-08-27T00:00:00.000Z",
      passed: false,
      readOnly: true,
      packageName: "com.wonderlang.app",
      rolloutPhase: "legacy_live_new_draft",
      webhookProcessingEnabled: false,
      checks: [{
        id: "provider-credentials",
        state: "failed",
        issues: ["Dedicated Google Play credentials are not installed in this test deployment."]
      }]
    });
  });
});
