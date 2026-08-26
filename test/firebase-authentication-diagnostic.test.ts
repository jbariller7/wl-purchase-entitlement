import { describe, expect, it } from "vitest";
import type { FirebaseAuthDiagnosticEnvironment } from "../src/config/env.js";
import {
  diagnoseFirebaseAuthentication,
  type FirebaseAuthenticationConfigurationReader,
  type FirebaseAuthenticationProjectConfig,
  type FirebaseDefaultProviderConfig
} from "../src/providers/firebase-auth/configuration-diagnostic.js";

function environment(): FirebaseAuthDiagnosticEnvironment {
  return {
    FIREBASE_PROJECT_ID: "wonderlang-accounts",
    FIREBASE_CLIENT_EMAIL: "firebase@example.iam.gserviceaccount.com",
    FIREBASE_PRIVATE_KEY: "test-only",
    FIREBASE_STORAGE_BUCKET: "wonderlang-accounts.firebasestorage.app",
    FIREBASE_AUTH_DOMAIN: "wonderlang-accounts.firebaseapp.com",
    PUBLIC_APP_ORIGIN: "https://wonderlang.net",
    FIREBASE_APPLE_SERVICE_ID: "com.wonderlang.account",
    FIREBASE_APPLE_BUNDLE_ID: "com.wonderlang.app",
    FIREBASE_REQUIRED_AUTHORIZED_DOMAINS: '["wonderlang-accounts.firebaseapp.com","wl-purchase-entitlement.netlify.app","wonderlang.net","www.wonderlang.net"]'
  };
}

function project(overrides: Partial<FirebaseAuthenticationProjectConfig> = {}): FirebaseAuthenticationProjectConfig {
  return {
    name: "projects/wonderlang-accounts/config",
    authorizedDomains: [
      "wonderlang-accounts.firebaseapp.com",
      "wl-purchase-entitlement.netlify.app",
      "wonderlang.net",
      "www.wonderlang.net"
    ],
    firebaseSubdomain: "wonderlang-accounts",
    emailEnabled: true,
    passwordRequired: false,
    allowDuplicateEmails: true,
    userSignupDisabled: false,
    userDeletionDisabled: false,
    improvedEmailPrivacy: true,
    ...overrides
  };
}

function provider(providerId: string, overrides: Partial<FirebaseDefaultProviderConfig> = {}): FirebaseDefaultProviderConfig {
  return {
    providerId,
    enabled: true,
    clientIdConfigured: true,
    clientId: providerId === "apple.com" ? "com.wonderlang.account" : "google-client.apps.googleusercontent.com",
    appleBundleIds: providerId === "apple.com" ? ["com.wonderlang.app"] : [],
    appleTeamIdConfigured: providerId === "apple.com",
    appleKeyIdConfigured: providerId === "apple.com",
    applePrivateKeyConfigured: providerId === "apple.com",
    ...overrides
  };
}

function reader(input: {
  project?: FirebaseAuthenticationProjectConfig;
  providers?: FirebaseDefaultProviderConfig[];
} = {}): FirebaseAuthenticationConfigurationReader {
  return {
    async projectConfig() { return input.project ?? project(); },
    async defaultProviders() { return input.providers ?? [provider("google.com"), provider("apple.com")]; }
  };
}

describe("read-only Firebase Authentication diagnostic", () => {
  it("validates the WonderLang project, domains, passwordless email, account policy, Google and Apple", async () => {
    const result = await diagnoseFirebaseAuthentication({
      reader: reader(),
      environment: environment(),
      now: new Date("2026-08-26T00:00:00.000Z")
    });

    expect(result).toMatchObject({
      checkedAt: "2026-08-26T00:00:00.000Z",
      passed: true,
      readOnly: true,
      projectId: "wonderlang-accounts"
    });
    expect(result.checks).toHaveLength(5);
    expect(result.checks.every((check) => check.state === "passed")).toBe(true);
    expect(result.checks.find((check) => check.id === "project-domains")?.details).toMatchObject({ missingDomains: [] });
    expect(result.checks.find((check) => check.id === "apple-provider")?.details).toMatchObject({
      enabled: true,
      serviceIdMatches: true,
      bundleIdPresent: true,
      codeFlowCredentialsComplete: true
    });
    expect(JSON.stringify(result)).not.toContain("test-only");
    expect(JSON.stringify(result)).not.toContain("google-client.apps.googleusercontent.com");
  });

  it("accepts Identity Platform's canonical numeric Google Cloud project resource name", async () => {
    const result = await diagnoseFirebaseAuthentication({
      reader: reader({ project: project({ name: "projects/1034814537215/config" }) }),
      environment: environment(),
      now: new Date("2026-08-26T00:00:00.000Z")
    });

    expect(result.checks.find((check) => check.id === "project-domains")).toMatchObject({
      resourceId: "projects/1034814537215/config",
      state: "passed",
      issues: []
    });
  });

  it("reports every unsafe or incomplete authentication setting without exposing provider credentials", async () => {
    const result = await diagnoseFirebaseAuthentication({
      reader: reader({
        project: project({
          authorizedDomains: ["wonderlang-accounts.firebaseapp.com"],
          passwordRequired: true,
          allowDuplicateEmails: false,
          userSignupDisabled: true,
          userDeletionDisabled: true,
          improvedEmailPrivacy: false
        }),
        providers: [
          provider("google.com", { enabled: false, clientIdConfigured: false, clientId: null }),
          provider("apple.com", {
            enabled: false,
            clientId: "wrong.service.id",
            appleBundleIds: [],
            appleTeamIdConfigured: false,
            appleKeyIdConfigured: false,
            applePrivateKeyConfigured: false
          })
        ]
      }),
      environment: environment(),
      now: new Date("2026-08-26T00:00:00.000Z")
    });

    expect(result.passed).toBe(false);
    expect(result.checks.find((check) => check.id === "project-domains")?.issues).toContain(
      "Missing authorized domains: wl-purchase-entitlement.netlify.app, wonderlang.net, www.wonderlang.net."
    );
    expect(result.checks.find((check) => check.id === "passwordless-email")?.issues).toContain(
      "Email authentication requires a password, so passwordless email links are disabled."
    );
    expect(result.checks.find((check) => check.id === "account-safety")?.issues).toHaveLength(4);
    expect(result.checks.find((check) => check.id === "google-provider")?.issues).toHaveLength(2);
    expect(result.checks.find((check) => check.id === "apple-provider")?.issues).toHaveLength(4);
    expect(JSON.stringify(result)).not.toContain("wrong.service.id");
  });

  it("sanitizes Identity Platform permission and provider failures", async () => {
    const result = await diagnoseFirebaseAuthentication({
      reader: {
        async projectConfig() { throw new Error("raw Google response with service-account details"); },
        async defaultProviders() { throw new Error("raw provider secret"); }
      },
      environment: environment(),
      now: new Date("2026-08-26T00:00:00.000Z")
    });

    expect(result.passed).toBe(false);
    expect(result.checks).toHaveLength(5);
    expect(result.checks.every((check) => check.issues[0] === "Firebase Authentication configuration could not be read with the configured Admin credential.")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("raw Google response");
    expect(JSON.stringify(result)).not.toContain("raw provider secret");
  });
});
