import type { Auth, DecodedIdToken, UserRecord } from "firebase-admin/auth";

const normalized = (value: string | undefined | null) => value?.trim().toLowerCase() || null;

/** Display/search only. A provider email alone is not proof of verification. */
export function accountEmails(user: Pick<UserRecord, "email" | "providerData">): string[] {
  return [...new Set([user.email, ...(user.providerData ?? []).map(p => p.email)]
    .map(normalized).filter((value): value is string => Boolean(value)))];
}

/** Google is authoritative for Gmail addresses; not arbitrary third-party mailboxes. */
export function authoritativeGoogleEmail(user: UserRecord): string | null {
  if (user.disabled) return null;
  const google = user.providerData?.filter(p => p.providerId === "google.com" && p.uid);
  if (google?.length !== 1) return null;
  const email = normalized(google[0]!.email);
  if (!email || !/^[^\s@]+@gmail\.com$/.test(email)) return null;
  if (user.email && normalized(user.email) !== email) return null;
  return email;
}

/** Restore the Firebase primary email from its own authenticated Google record.
 * Never use a client-supplied email, overwrite another address, or merge UIDs.
 * Firebase enforces primary-email uniqueness atomically on updateUser.
 */
export async function restoreAccountEmail(auth: Auth, user: UserRecord): Promise<UserRecord> {
  if (user.disabled || (user.email && user.emailVerified)) return user;
  const email = authoritativeGoogleEmail(user);
  if (!email) return user;
  try {
    return await auth.updateUser(user.uid, { email, emailVerified: true });
  } catch (error) {
    if ((error as { code?: string }).code === "auth/email-already-exists") return user;
    throw error;
  }
}

/** A missing-email Google session must be normalized before purchase discovery.
 * Custom tokens cover the PC/Mac handoff of the same authenticated Firebase UID.
 * Administrator authentication deliberately does not use this normalization.
 */
export async function resolveAccountIdentity(token: DecodedIdToken, auth: Auth): Promise<DecodedIdToken> {
  if (token.email && token.email_verified) return token;
  if (!["google.com", "custom"].includes(token.firebase?.sign_in_provider)) return token;
  const original = await auth.getUser(token.uid);
  if (original.disabled || original.uid !== token.uid) return token;
  if (token.email && original.email && normalized(token.email) !== normalized(original.email)) return token;
  // Keep normal requests read-only: changing a Firebase primary email can
  // invalidate sessions. Explicit administrator recovery may persist it.
  const email = original.email && original.emailVerified ? original.email : authoritativeGoogleEmail(original);
  if (!email) return token;
  return { ...token, email, email_verified: true };
}
