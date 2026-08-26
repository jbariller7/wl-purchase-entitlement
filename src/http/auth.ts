import type { DecodedIdToken } from "firebase-admin/auth";
import { firebaseAuth } from "../infrastructure/firebase.js";
import { safeErrorMessage } from "../infrastructure/safe-error.js";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly headers: Readonly<Record<string, string>> = {}
  ) { super(message); }
}

export async function requireUser(authorization: string | undefined): Promise<DecodedIdToken> {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new HttpError(401, "A Firebase ID token is required.");
  const auth = firebaseAuth();
  try {
    return await auth.verifyIdToken(match[1], true);
  } catch (error) {
    let signatureValid = false;
    try {
      await auth.verifyIdToken(match[1], false);
      signatureValid = true;
    } catch {
      // Keep the public response generic. This second check only classifies the
      // failure for secret-free server diagnostics; it never authorizes access.
    }
    console.warn("Firebase ID token verification rejected", {
      signatureValid,
      error: safeErrorMessage(error, "Firebase token verification failed")
    });
    throw new HttpError(401, "The Firebase ID token is invalid or revoked.");
  }
}

export function requireAdmin(token: DecodedIdToken): DecodedIdToken {
  if (token.admin !== true) {
    throw new HttpError(403, "This account does not have WonderLang administrator access.");
  }
  if (!token.email || !token.email_verified) {
    throw new HttpError(403, "Administrator accounts must have a verified email address.");
  }
  return token;
}

export function requireVerifiedEmail(token: DecodedIdToken): string {
  if (!token.email || !token.email_verified) {
    throw new HttpError(403, "Verify the account email before claiming a historical purchase.");
  }
  return token.email.trim().toLowerCase();
}

/**
 * Firebase has already cryptographically verified the ID token before this is
 * called. Google and Apple authenticate ownership of the selected account, so
 * a federated sign-in may approve a desktop device even when Firebase omits or
 * delays the separate email_verified claim. Email/password and email-link
 * accounts must still carry that claim.
 */
export function requireVerifiedDeviceApprovalIdentity(token: DecodedIdToken): string {
  const email = token.email?.trim().toLowerCase();
  const provider = token.firebase?.sign_in_provider;
  const trustedFederatedProvider = provider === "google.com" || provider === "apple.com";
  if (!email || (token.email_verified !== true && !trustedFederatedProvider)) {
    throw new HttpError(403, "Verify your WonderLang account email before approving a new device.");
  }
  return email;
}
