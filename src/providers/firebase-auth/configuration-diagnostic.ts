import { GoogleAuth } from "google-auth-library";
import { z } from "zod";
import type { FirebaseAuthDiagnosticEnvironment } from "../../config/env.js";
import { normalizeGoogleServiceAccountPrivateKey } from "../../infrastructure/private-key.js";

export interface FirebaseAuthenticationProjectConfig {
  name: string;
  authorizedDomains: string[];
  firebaseSubdomain: string | null;
  emailEnabled: boolean;
  passwordRequired: boolean;
  allowDuplicateEmails: boolean;
  userSignupDisabled: boolean;
  userDeletionDisabled: boolean;
  improvedEmailPrivacy: boolean;
}

export interface FirebaseDefaultProviderConfig {
  providerId: string;
  enabled: boolean;
  clientIdConfigured: boolean;
  clientId: string | null;
  appleBundleIds: string[];
  appleTeamIdConfigured: boolean;
  appleKeyIdConfigured: boolean;
  applePrivateKeyConfigured: boolean;
}

export interface FirebaseAuthenticationConfigurationReader {
  projectConfig(projectId: string): Promise<FirebaseAuthenticationProjectConfig>;
  defaultProviders(projectId: string): Promise<FirebaseDefaultProviderConfig[]>;
}

export interface FirebaseAuthenticationDiagnosticCheck {
  id: string;
  label: string;
  resourceId: string;
  state: "passed" | "failed";
  issues: string[];
  details?: Record<string, string | number | boolean | string[] | null>;
}

export interface FirebaseAuthenticationDiagnostic {
  checkedAt: string;
  passed: boolean;
  readOnly: true;
  projectId: string;
  checks: FirebaseAuthenticationDiagnosticCheck[];
}

const requiredDomainsSchema = z.array(z.string().trim().min(1)).min(1).max(20);

function requiredDomains(value: string): string[] {
  try {
    return [...new Set(requiredDomainsSchema.parse(JSON.parse(value)).map((domain) => domain.toLowerCase()))].sort();
  } catch {
    throw new Error("FIREBASE_REQUIRED_AUTHORIZED_DOMAINS must be a JSON string array.");
  }
}

function result(input: Omit<FirebaseAuthenticationDiagnosticCheck, "state">): FirebaseAuthenticationDiagnosticCheck {
  return { ...input, state: input.issues.length ? "failed" : "passed" };
}

function failedChecks(projectId: string): FirebaseAuthenticationDiagnosticCheck[] {
  return [
    ["project-domains", "WonderLang account project and authorized domains", `projects/${projectId}/config`],
    ["passwordless-email", "Passwordless email sign-in", "emailLink"],
    ["account-safety", "Account creation, linking and privacy policy", "accountPolicy"],
    ["google-provider", "Google sign-in provider", "google.com"],
    ["apple-provider", "Apple sign-in provider", "apple.com"]
  ].map(([id, label, resourceId]) => result({
    id: id!,
    label: label!,
    resourceId: resourceId!,
    issues: ["Firebase Authentication configuration could not be read with the configured Admin credential."]
  }));
}

export async function diagnoseFirebaseAuthentication(input: {
  reader: FirebaseAuthenticationConfigurationReader;
  environment: FirebaseAuthDiagnosticEnvironment;
  now: Date;
}): Promise<FirebaseAuthenticationDiagnostic> {
  const { environment } = input;
  try {
    const [project, providers] = await Promise.all([
      input.reader.projectConfig(environment.FIREBASE_PROJECT_ID),
      input.reader.defaultProviders(environment.FIREBASE_PROJECT_ID)
    ]);
    const publicAppHostname = new URL(environment.PUBLIC_APP_ORIGIN).hostname.toLowerCase();
    const expectedDomains = [...new Set([
      ...requiredDomains(environment.FIREBASE_REQUIRED_AUTHORIZED_DOMAINS),
      environment.FIREBASE_AUTH_DOMAIN.toLowerCase(),
      publicAppHostname
    ])].sort();
    const actualDomains = new Set(project.authorizedDomains.map((domain) => domain.toLowerCase()));
    const missingDomains = expectedDomains.filter((domain) => !actualDomains.has(domain));
    const projectIssues: string[] = [];
    const expectedProjectName = `projects/${environment.FIREBASE_PROJECT_ID}/config`;
    // Identity Platform may canonicalize a Firebase project ID to its numeric
    // Google Cloud project number in this resource name. The request itself is
    // still scoped to FIREBASE_PROJECT_ID, so either canonical form is valid.
    if (project.name !== expectedProjectName && !/^projects\/\d+\/config$/.test(project.name)) {
      projectIssues.push("Identity Platform returned a different Firebase project.");
    }
    const actualSubdomain = project.firebaseSubdomain?.replace(/\.firebaseapp\.com$/i, "").toLowerCase();
    const expectedSubdomain = environment.FIREBASE_AUTH_DOMAIN.replace(/\.firebaseapp\.com$/i, "").toLowerCase();
    if (actualSubdomain && actualSubdomain !== expectedSubdomain) {
      projectIssues.push("The Firebase authentication subdomain does not match FIREBASE_AUTH_DOMAIN.");
    }
    if (missingDomains.length) projectIssues.push(`Missing authorized domains: ${missingDomains.join(", ")}.`);

    const emailIssues: string[] = [];
    if (!project.emailEnabled) emailIssues.push("Email authentication is disabled.");
    if (project.passwordRequired) emailIssues.push("Email authentication requires a password, so passwordless email links are disabled.");

    const safetyIssues: string[] = [];
    if (!project.allowDuplicateEmails) safetyIssues.push("Duplicate provider emails are disallowed; explicit Google/Apple account linking cannot use the approved separate-account policy.");
    if (project.userSignupDisabled) safetyIssues.push("New WonderLang account creation is disabled.");
    if (project.userDeletionDisabled) safetyIssues.push("Firebase user deletion is disabled.");
    if (!project.improvedEmailPrivacy) safetyIssues.push("Email-enumeration protection is disabled.");

    const google = providers.find((provider) => provider.providerId === "google.com");
    const googleIssues: string[] = [];
    if (!google) googleIssues.push("Google is not configured as a Firebase sign-in provider.");
    else {
      if (!google.enabled) googleIssues.push("Google sign-in is configured but disabled.");
      if (!google.clientIdConfigured) googleIssues.push("Google sign-in has no OAuth client ID.");
    }

    const apple = providers.find((provider) => provider.providerId === "apple.com");
    const appleIssues: string[] = [];
    if (!apple) appleIssues.push("Apple is not configured as a Firebase sign-in provider.");
    else {
      if (!apple.enabled) appleIssues.push("Apple sign-in is configured but disabled.");
      if (apple.clientId !== environment.FIREBASE_APPLE_SERVICE_ID) appleIssues.push("Apple's Firebase Service ID does not match the configured WonderLang Service ID.");
      if (!apple.appleBundleIds.includes(environment.FIREBASE_APPLE_BUNDLE_ID)) appleIssues.push("Apple's Firebase provider does not include the WonderLang bundle ID.");
      if (!apple.appleTeamIdConfigured || !apple.appleKeyIdConfigured || !apple.applePrivateKeyConfigured) {
        appleIssues.push("Apple code-flow credentials are incomplete.");
      }
    }

    const checks = [
      result({
        id: "project-domains",
        label: "WonderLang account project and authorized domains",
        resourceId: project.name,
        issues: projectIssues,
        details: {
          authDomain: environment.FIREBASE_AUTH_DOMAIN,
          authorizedDomains: project.authorizedDomains.slice().sort(),
          missingDomains
        }
      }),
      result({
        id: "passwordless-email",
        label: "Passwordless email sign-in",
        resourceId: "emailLink",
        issues: emailIssues,
        details: { emailEnabled: project.emailEnabled, passwordRequired: project.passwordRequired }
      }),
      result({
        id: "account-safety",
        label: "Account creation, linking and privacy policy",
        resourceId: "accountPolicy",
        issues: safetyIssues,
        details: {
          separateProviderAccounts: project.allowDuplicateEmails,
          userSignupEnabled: !project.userSignupDisabled,
          userDeletionEnabled: !project.userDeletionDisabled,
          emailEnumerationProtection: project.improvedEmailPrivacy
        }
      }),
      result({
        id: "google-provider",
        label: "Google sign-in provider",
        resourceId: "google.com",
        issues: googleIssues,
        details: { enabled: google?.enabled ?? false, oauthClientConfigured: google?.clientIdConfigured ?? false }
      }),
      result({
        id: "apple-provider",
        label: "Apple sign-in provider",
        resourceId: "apple.com",
        issues: appleIssues,
        details: {
          enabled: apple?.enabled ?? false,
          serviceIdMatches: apple?.clientId === environment.FIREBASE_APPLE_SERVICE_ID,
          bundleIdPresent: apple?.appleBundleIds.includes(environment.FIREBASE_APPLE_BUNDLE_ID) ?? false,
          codeFlowCredentialsComplete: Boolean(apple?.appleTeamIdConfigured && apple.appleKeyIdConfigured && apple.applePrivateKeyConfigured)
        }
      })
    ];
    return {
      checkedAt: input.now.toISOString(),
      passed: checks.every((check) => check.state === "passed"),
      readOnly: true,
      projectId: environment.FIREBASE_PROJECT_ID,
      checks
    };
  } catch {
    return {
      checkedAt: input.now.toISOString(),
      passed: false,
      readOnly: true,
      projectId: environment.FIREBASE_PROJECT_ID,
      checks: failedChecks(environment.FIREBASE_PROJECT_ID)
    };
  }
}

interface RawProjectConfig {
  name?: string;
  authorizedDomains?: string[];
  signIn?: {
    email?: { enabled?: boolean; passwordRequired?: boolean };
    allowDuplicateEmails?: boolean;
  };
  client?: {
    firebaseSubdomain?: string;
    permissions?: { disabledUserSignup?: boolean; disabledUserDeletion?: boolean };
  };
  emailPrivacyConfig?: { enableImprovedEmailPrivacy?: boolean };
}

interface RawDefaultProviderConfig {
  name?: string;
  enabled?: boolean;
  clientId?: string;
  clientSecret?: string;
  appleSignInConfig?: {
    bundleIds?: string[];
    codeFlowConfig?: { teamId?: string; keyId?: string; privateKey?: string };
  };
}

interface RawDefaultProviderList {
  defaultSupportedIdpConfigs?: RawDefaultProviderConfig[];
}

export function createFirebaseAuthenticationConfigurationReader(environment: FirebaseAuthDiagnosticEnvironment): FirebaseAuthenticationConfigurationReader {
  const auth = new GoogleAuth({
    credentials: {
      client_email: environment.FIREBASE_CLIENT_EMAIL,
      private_key: normalizeGoogleServiceAccountPrivateKey(environment.FIREBASE_PRIVATE_KEY)
    },
    scopes: ["https://www.googleapis.com/auth/cloud-platform"]
  });
  return {
    async projectConfig(projectId) {
      const response = await auth.request<RawProjectConfig>({
        url: `https://identitytoolkit.googleapis.com/admin/v2/projects/${encodeURIComponent(projectId)}/config`,
        method: "GET"
      });
      const data = response.data;
      return {
        name: data.name ?? "",
        authorizedDomains: data.authorizedDomains ?? [],
        firebaseSubdomain: data.client?.firebaseSubdomain ?? null,
        emailEnabled: data.signIn?.email?.enabled === true,
        passwordRequired: data.signIn?.email?.passwordRequired === true,
        allowDuplicateEmails: data.signIn?.allowDuplicateEmails === true,
        userSignupDisabled: data.client?.permissions?.disabledUserSignup === true,
        userDeletionDisabled: data.client?.permissions?.disabledUserDeletion === true,
        improvedEmailPrivacy: data.emailPrivacyConfig?.enableImprovedEmailPrivacy === true
      };
    },
    async defaultProviders(projectId) {
      const response = await auth.request<RawDefaultProviderList>({
        url: `https://identitytoolkit.googleapis.com/admin/v2/projects/${encodeURIComponent(projectId)}/defaultSupportedIdpConfigs?pageSize=100`,
        method: "GET"
      });
      return (response.data.defaultSupportedIdpConfigs ?? []).map((provider) => {
        const codeFlow = provider.appleSignInConfig?.codeFlowConfig;
        return {
          providerId: provider.name?.split("/").at(-1) ?? "",
          enabled: provider.enabled === true,
          clientIdConfigured: Boolean(provider.clientId),
          clientId: provider.clientId ?? null,
          appleBundleIds: provider.appleSignInConfig?.bundleIds ?? [],
          appleTeamIdConfigured: Boolean(codeFlow?.teamId),
          appleKeyIdConfigured: Boolean(codeFlow?.keyId),
          applePrivateKeyConfigured: Boolean(codeFlow?.privateKey)
        };
      });
    }
  };
}
