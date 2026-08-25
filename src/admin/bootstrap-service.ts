import type { DecodedIdToken, Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { HttpError } from "../http/auth.js";

const RECENT_AUTH_SECONDS = 10 * 60;

function normalizedEmail(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function adminBootstrapConfirmation(email: string): string {
  return `SET ADMIN ${normalizedEmail(email)}`;
}

export class AdminBootstrapService {
  constructor(private readonly auth: Auth, private readonly db: Firestore) {}

  async grant(input: {
    actor: DecodedIdToken;
    configuredEmail: string;
    confirmationPhrase: string;
    now: Date;
  }): Promise<{ granted: true; changed: boolean; signInAgain: boolean }> {
    const configuredEmail = normalizedEmail(input.configuredEmail);
    const actorEmail = normalizedEmail(input.actor.email);
    if (!configuredEmail || actorEmail !== configuredEmail || !input.actor.email_verified) {
      throw new HttpError(403, "This verified account is not the configured WonderLang bootstrap administrator.");
    }
    if (input.actor.firebase?.sign_in_provider !== "google.com") {
      throw new HttpError(403, "Use the configured Google account for the initial administrator grant.");
    }
    const authTime = input.actor.auth_time;
    if (!authTime || Math.floor(input.now.getTime() / 1000) - authTime > RECENT_AUTH_SECONDS) {
      throw new HttpError(401, "Sign in with Google again before granting initial administrator access.");
    }
    if (input.confirmationPhrase !== adminBootstrapConfirmation(configuredEmail)) {
      throw new HttpError(400, `Type ${adminBootstrapConfirmation(configuredEmail)} to confirm.`);
    }

    const user = await this.auth.getUser(input.actor.uid);
    if (!user.emailVerified || normalizedEmail(user.email) !== configuredEmail) {
      throw new HttpError(403, "The Firebase user email is not verified for the configured administrator account.");
    }
    if (user.customClaims?.admin === true) {
      return { granted: true, changed: false, signInAgain: false };
    }

    const audit = await this.db.collection("adminBootstrapAudit").add({
      action: "admin_claim.set",
      state: "started",
      actorUid: input.actor.uid,
      targetUid: user.uid,
      targetEmail: configuredEmail,
      signInProvider: "google.com",
      createdAt: input.now.toISOString()
    });
    try {
      await this.auth.setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), admin: true });
      await this.auth.revokeRefreshTokens(user.uid);
      await audit.update({ state: "completed", completedAt: input.now.toISOString() });
    } catch (error) {
      await audit.update({ state: "failed", failedAt: input.now.toISOString() }).catch(() => undefined);
      throw error;
    }
    return { granted: true, changed: true, signInAgain: true };
  }
}
