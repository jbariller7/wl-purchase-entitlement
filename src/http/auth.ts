import type { DecodedIdToken } from "firebase-admin/auth";
import { firebaseAuth } from "../infrastructure/firebase.js";

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
  try {
    return await firebaseAuth().verifyIdToken(match[1], true);
  } catch {
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
