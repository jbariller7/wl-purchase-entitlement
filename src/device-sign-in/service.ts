import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Auth, DecodedIdToken } from "firebase-admin/auth";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpError } from "../http/auth.js";
import { sha256 } from "../infrastructure/ids.js";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const SESSION_TTL_MS = 10 * 60 * 1000;
const ISSUANCE_LEASE_MS = 30 * 1000;
const CODE_PATTERN = /^[2-9A-HJ-NP-Z]{8}$/;
const ACCOUNT_SECURITY_COLLECTION = "accountSecurity";

export type DeviceSignInState = "pending" | "approved" | "issuing" | "consumed" | "expired";

export interface DeviceSignInSession {
  state: DeviceSignInState;
  pollSecretHash: string;
  browserApprovalSecretHash?: string;
  deviceLabel: string;
  createdAt: string;
  expiresAt: string;
  approvedUid?: string;
  approvedAt?: string;
  deviceSessionGeneration?: number;
  issuanceId?: string;
  issuanceStartedAt?: string;
  consumedAt?: string;
}

export type DeviceSignInLease =
  | { state: "pending"; retryAfterSeconds: number }
  | { state: "issuing"; uid: string; issuanceId: string; deviceSessionGeneration: number; retryAfterSeconds: 0 };

export interface DeviceSessionSecurityState {
  deviceSessionGeneration: number;
  sessionsRevokedAuthTime: number;
}

function safeGeneration(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  throw new Error("Stored device-session generation is invalid.");
}

function safeRevokedAuthTime(value: unknown): number {
  if (value === undefined) return -1;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  throw new Error("Stored session-revocation cutoff is invalid.");
}

export function readDeviceSessionSecurityState(data: Record<string, unknown> | undefined): DeviceSessionSecurityState {
  return {
    deviceSessionGeneration: safeGeneration(data?.deviceSessionGeneration),
    sessionsRevokedAuthTime: safeRevokedAuthTime(data?.sessionsRevokedAuthTime)
  };
}

export function requireAuthenticationAfterSessionRevocation(
  state: DeviceSessionSecurityState,
  authTimeSeconds: number
): void {
  if (!Number.isSafeInteger(authTimeSeconds) || authTimeSeconds < 0 || authTimeSeconds <= state.sessionsRevokedAuthTime) {
    throw new HttpError(401, "This account session was revoked. Sign out and sign in again.");
  }
}

export async function currentDeviceSessionGeneration(db: Firestore, uid: string): Promise<number> {
  const snapshot = await db.collection(ACCOUNT_SECURITY_COLLECTION).doc(uid).get();
  return readDeviceSessionSecurityState(snapshot.data()).deviceSessionGeneration;
}

export async function requireCurrentDeviceSessionGeneration(
  db: Firestore,
  token: DecodedIdToken
): Promise<void> {
  if (token.wlDeviceSignIn !== true) return;
  const claimedGeneration = token.wlDeviceSessionGeneration;
  if (typeof claimedGeneration !== "number" || !Number.isSafeInteger(claimedGeneration) || claimedGeneration < 0) {
    throw new HttpError(401, "This PC/Mac session is no longer valid. Sign in again.");
  }
  const currentGeneration = await currentDeviceSessionGeneration(db, token.uid);
  if (claimedGeneration !== currentGeneration) {
    throw new HttpError(401, "This PC/Mac session was revoked. Sign in again.");
  }
}

export async function rotateDeviceSessionGeneration(
  db: Firestore,
  uid: string,
  now: Date
): Promise<number> {
  const ref = db.collection(ACCOUNT_SECURITY_COLLECTION).doc(uid);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = readDeviceSessionSecurityState(snapshot.data()).deviceSessionGeneration;
    if (current >= Number.MAX_SAFE_INTEGER) throw new Error("Device-session generation is exhausted.");
    const next = current + 1;
    transaction.set(ref, {
      deviceSessionGeneration: next,
      sessionsRevokedAuthTime: Math.floor(now.getTime() / 1000),
      sessionsRevokedAt: now.toISOString(),
      updatedAt: now.toISOString()
    }, { merge: true });
    return next;
  });
}

export async function invalidateDeviceSignInsForUid(
  db: Firestore,
  uid: string,
  now: Date
): Promise<{ canceledDeviceSignIns: number; deviceSessionGeneration: number }> {
  // Delete first, then rotate. An approval racing the delete either binds the
  // old generation and becomes invalid at rotation, or observes the rotation
  // and must present a Firebase authentication newer than the revocation.
  const canceledDeviceSignIns = await deleteDeviceSignInSessionsForUid(db, uid);
  const deviceSessionGeneration = await rotateDeviceSessionGeneration(db, uid, now);
  return { canceledDeviceSignIns, deviceSessionGeneration };
}

export async function deleteDeviceSignInSessionsForUid(db: Firestore, uid: string): Promise<number> {
  let deleted = 0;
  while (true) {
    const snapshot = await db.collection("deviceSignInSessions")
      .where("approvedUid", "==", uid)
      .limit(400)
      .get();
    if (snapshot.empty) return deleted;
    const batch = db.batch();
    for (const document of snapshot.docs) batch.delete(document.ref);
    await batch.commit();
    deleted += snapshot.size;
  }
}

export async function deleteExpiredDeviceSignInSessions(db: Firestore, now: Date): Promise<number> {
  let deleted = 0;
  while (true) {
    const snapshot = await db.collection("deviceSignInSessions")
      .where("expiresAt", "<=", now.toISOString())
      .limit(400)
      .get();
    if (snapshot.empty) return deleted;
    const batch = db.batch();
    for (const document of snapshot.docs) batch.delete(document.ref);
    await batch.commit();
    deleted += snapshot.size;
  }
}

function expired(session: DeviceSignInSession, now: Date): boolean {
  return !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= now.getTime();
}

function secureHashMatches(actualHex: string, expectedHex: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(actualHex) || !/^[a-f0-9]{64}$/.test(expectedHex)) return false;
  return timingSafeEqual(Buffer.from(actualHex, "hex"), Buffer.from(expectedHex, "hex"));
}

export function requireBrowserApprovalSecret(session: DeviceSignInSession, approvalSecret: string): void {
  const presentedApprovalHash = sha256(approvalSecret);
  if (!session.browserApprovalSecretHash || !secureHashMatches(session.browserApprovalSecretHash, presentedApprovalHash)) {
    throw new HttpError(401, "This WonderLang browser sign-in request is invalid or expired.");
  }
}

export function normalizeDeviceUserCode(value: string): string {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!CODE_PATTERN.test(normalized)) throw new HttpError(400, "Enter the eight-character device code shown by WonderLang.");
  return normalized;
}

export function formatDeviceUserCode(value: string): string {
  const normalized = normalizeDeviceUserCode(value);
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

export function deviceSessionDocumentId(userCode: string): string {
  return sha256(`device-sign-in:${normalizeDeviceUserCode(userCode)}`);
}

export function approveDeviceSession(
  session: DeviceSignInSession,
  uid: string,
  deviceSessionGeneration: number,
  now: Date
): DeviceSignInSession {
  if (expired(session, now) || session.state === "expired") throw new HttpError(410, "This device code has expired. Start sign-in again in WonderLang.");
  if (session.state === "consumed") throw new HttpError(410, "This device code has already been used. Start sign-in again in WonderLang.");
  if (session.approvedUid && session.approvedUid !== uid) throw new HttpError(409, "This device code was already approved for another WonderLang account.");
  if (session.state === "issuing") throw new HttpError(409, "This device sign-in is already being completed in WonderLang.");
  return {
    ...session,
    state: "approved",
    approvedUid: uid,
    approvedAt: session.approvedAt ?? now.toISOString(),
    deviceSessionGeneration
  };
}

export function leaseDeviceSession(
  session: DeviceSignInSession,
  presentedSecretHash: string,
  issuanceId: string,
  now: Date
): { session: DeviceSignInSession; lease: DeviceSignInLease } {
  // Unknown code and wrong secret intentionally share the same response.
  if (!secureHashMatches(session.pollSecretHash, presentedSecretHash)) {
    throw new HttpError(401, "The device sign-in code or polling secret is invalid.");
  }
  if (expired(session, now) || session.state === "expired") throw new HttpError(410, "This device sign-in has expired. Start again.");
  if (session.state === "consumed") throw new HttpError(410, "This device sign-in was already completed.");
  if (session.state === "pending") return { session, lease: { state: "pending", retryAfterSeconds: 3 } };
  if (session.state === "issuing") {
    const started = Date.parse(session.issuanceStartedAt ?? "");
    if (Number.isFinite(started) && now.getTime() - started < ISSUANCE_LEASE_MS) {
      return { session, lease: { state: "pending", retryAfterSeconds: 3 } };
    }
  }
  if (!session.approvedUid) throw new Error("Approved device sign-in session has no account link.");
  const next: DeviceSignInSession = {
    ...session,
    state: "issuing",
    issuanceId,
    issuanceStartedAt: now.toISOString()
  };
  return {
    session: next,
    lease: {
      state: "issuing",
      uid: session.approvedUid,
      issuanceId,
      deviceSessionGeneration: safeGeneration(session.deviceSessionGeneration),
      retryAfterSeconds: 0
    }
  };
}

export function consumeDeviceSession(session: DeviceSignInSession, issuanceId: string, now: Date): DeviceSignInSession {
  if (session.state !== "issuing" || session.issuanceId !== issuanceId) {
    throw new HttpError(409, "Device sign-in issuance changed before completion. Poll again.");
  }
  const { approvedUid: _approvedUid, issuanceId: _issuanceId, issuanceStartedAt: _started, ...rest } = session;
  return { ...rest, state: "consumed", consumedAt: now.toISOString() };
}

function createUserCode(): string {
  const bytes = randomBytes(8);
  return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function safeDeviceLabel(value: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return (normalized || "WonderLang PC/Mac").slice(0, 64);
}

export class DeviceSignInService {
  constructor(private readonly db: Firestore, private readonly auth: Auth) {}

  async start(input: { deviceLabel: string; now: Date; publicAppOrigin: string }): Promise<{
    userCode: string;
    pollSecret: string;
    verificationUrl: string;
    expiresAt: string;
    intervalSeconds: number;
  }> {
    const expiresAt = new Date(input.now.getTime() + SESSION_TTL_MS).toISOString();
    const pollSecret = randomBytes(32).toString("base64url");
    const browserApprovalSecret = randomBytes(32).toString("base64url");
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const rawCode = createUserCode();
      const userCode = formatDeviceUserCode(rawCode);
      const ref = this.db.collection("deviceSignInSessions").doc(deviceSessionDocumentId(rawCode));
      try {
        await ref.create({
          state: "pending",
          pollSecretHash: sha256(pollSecret),
          browserApprovalSecretHash: sha256(browserApprovalSecret),
          deviceLabel: safeDeviceLabel(input.deviceLabel),
          createdAt: input.now.toISOString(),
          expiresAt
        } satisfies DeviceSignInSession);
        const verificationUrl = new URL("/account/", input.publicAppOrigin);
        // Keep the automatic browser handoff secret in the URL fragment. Fragments
        // are available to the account-page JavaScript but are not sent in HTTP
        // requests, Netlify access logs, or referrer headers.
        verificationUrl.hash = new URLSearchParams({
          desktop_sign_in: `${userCode}.${browserApprovalSecret}`
        }).toString();
        return { userCode, pollSecret, verificationUrl: verificationUrl.toString(), expiresAt, intervalSeconds: 3 };
      } catch (error) {
        if ((error as { code?: number | string }).code !== 6 && (error as { code?: number | string }).code !== "already-exists") throw error;
      }
    }
    throw new HttpError(503, "Could not allocate a unique device code. Try again shortly.");
  }

  async preview(input: { uid: string; userCode: string; now: Date }): Promise<{ userCode: string; deviceLabel: string; expiresAt: string; state: "pending" | "approved" }> {
    const userCode = formatDeviceUserCode(input.userCode);
    const snapshot = await this.db.collection("deviceSignInSessions").doc(deviceSessionDocumentId(userCode)).get();
    if (!snapshot.exists) throw new HttpError(404, "This device code was not found. Check the code shown by WonderLang.");
    const session = snapshot.data() as DeviceSignInSession;
    if (expired(session, input.now) || session.state === "expired") throw new HttpError(410, "This device code has expired. Start sign-in again in WonderLang.");
    if (session.state === "consumed") throw new HttpError(410, "This device code has already been used.");
    if (session.approvedUid && session.approvedUid !== input.uid) throw new HttpError(409, "This device code was already approved for another WonderLang account.");
    return { userCode, deviceLabel: session.deviceLabel, expiresAt: session.expiresAt, state: session.state === "approved" ? "approved" : "pending" };
  }

  async approve(input: { uid: string; userCode: string; approvalSecret?: string; authTimeSeconds: number; now: Date }): Promise<{ approved: true; userCode: string; deviceLabel: string }> {
    const userCode = formatDeviceUserCode(input.userCode);
    const ref = this.db.collection("deviceSignInSessions").doc(deviceSessionDocumentId(userCode));
    const securityRef = this.db.collection(ACCOUNT_SECURITY_COLLECTION).doc(input.uid);
    const result = await this.db.runTransaction(async (transaction) => {
      const [snapshot, securitySnapshot] = await Promise.all([
        transaction.get(ref),
        transaction.get(securityRef)
      ]);
      if (!snapshot.exists) throw new HttpError(404, "This device code was not found. Check the code shown by WonderLang.");
      const session = snapshot.data() as DeviceSignInSession;
      if (input.approvalSecret !== undefined) {
        requireBrowserApprovalSecret(session, input.approvalSecret);
      }
      const security = readDeviceSessionSecurityState(securitySnapshot.data());
      requireAuthenticationAfterSessionRevocation(security, input.authTimeSeconds);
      const next = approveDeviceSession(
        session,
        input.uid,
        security.deviceSessionGeneration,
        input.now
      );
      transaction.set(ref, next);
      return next;
    });
    return { approved: true, userCode, deviceLabel: result.deviceLabel };
  }

  async poll(input: { userCode: string; pollSecret: string; now: Date }): Promise<
    { state: "pending"; retryAfterSeconds: number } |
    { state: "authorized"; customToken: string }
  > {
    const ref = this.db.collection("deviceSignInSessions").doc(deviceSessionDocumentId(input.userCode));
    const presentedSecretHash = sha256(input.pollSecret);
    const issuanceId = randomUUID();
    const lease = await this.db.runTransaction(async (transaction): Promise<DeviceSignInLease> => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new HttpError(401, "The device sign-in code or polling secret is invalid.");
      const transition = leaseDeviceSession(snapshot.data() as DeviceSignInSession, presentedSecretHash, issuanceId, input.now);
      if (transition.lease.state === "issuing") transaction.set(ref, transition.session);
      return transition.lease;
    });
    if (lease.state === "pending") return lease;
    try {
      const currentGeneration = await currentDeviceSessionGeneration(this.db, lease.uid);
      if (currentGeneration !== lease.deviceSessionGeneration) {
        await this.db.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(ref);
          if (!snapshot.exists) return;
          const session = snapshot.data() as DeviceSignInSession;
          if (session.state === "issuing" && session.issuanceId === lease.issuanceId) transaction.delete(ref);
        });
        throw new HttpError(410, "This device approval was revoked. Start sign-in again in WonderLang.");
      }
      const customToken = await this.auth.createCustomToken(lease.uid, {
        wlDeviceSignIn: true,
        wlDeviceSessionGeneration: lease.deviceSessionGeneration
      });
      await this.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw new HttpError(409, "Device sign-in session disappeared during issuance.");
        transaction.set(ref, consumeDeviceSession(snapshot.data() as DeviceSignInSession, lease.issuanceId!, input.now));
      });
      return { state: "authorized", customToken };
    } catch (error) {
      await this.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return;
        const session = snapshot.data() as DeviceSignInSession;
        if (session.state === "issuing" && session.issuanceId === lease.issuanceId) {
          transaction.update(ref, {
            state: "approved",
            issuanceId: FieldValue.delete(),
            issuanceStartedAt: FieldValue.delete()
          });
        }
      }).catch(() => undefined);
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, "Device sign-in could not issue a token. Poll again shortly.");
    }
  }
}
