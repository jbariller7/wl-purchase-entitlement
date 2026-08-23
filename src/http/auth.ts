import type { DecodedIdToken } from "firebase-admin/auth";
import { firebaseAuth } from "../infrastructure/firebase.js";

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
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

export function requireVerifiedEmail(token: DecodedIdToken): string {
  if (!token.email || !token.email_verified) {
    throw new HttpError(403, "Verify the account email before claiming a historical purchase.");
  }
  return token.email.trim().toLowerCase();
}
