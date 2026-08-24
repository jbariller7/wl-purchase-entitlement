import type { AppCheck } from "firebase-admin/app-check";
import { HttpError } from "./auth.js";

/**
 * App Check is a separate control from Firebase Authentication. It stays
 * disabled until every supported web/mobile/desktop client can mint tokens.
 */
export async function requireAppCheck(
  token: string | undefined,
  verifier: Pick<AppCheck, "verifyToken">,
  enforced: boolean
): Promise<void> {
  if (!enforced) return;
  if (!token || token.length > 8192) throw new HttpError(401, "A Firebase App Check token is required.");
  try {
    await verifier.verifyToken(token);
  } catch {
    throw new HttpError(401, "The Firebase App Check token is invalid or expired.");
  }
}
