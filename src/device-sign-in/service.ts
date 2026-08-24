import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Auth } from "firebase-admin/auth";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpError } from "../http/auth.js";
import { sha256 } from "../infrastructure/ids.js";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const SESSION_TTL_MS = 10 * 60 * 1000;
const ISSUANCE_LEASE_MS = 30 * 1000;
const CODE_PATTERN = /^[2-9A-HJ-NP-Z]{8}$/;

export type DeviceSignInState = "pending" | "approved" | "issuing" | "consumed" | "expired";

export interface DeviceSignInSession {
  state: DeviceSignInState;
  pollSecretHash: string;
  deviceLabel: string;
  createdAt: string;
  expiresAt: string;
  approvedUid?: string;
  approvedAt?: string;
  issuanceId?: string;
  issuanceStartedAt?: string;
  consumedAt?: string;
}

export type DeviceSignInLease =
  | { state: "pending"; retryAfterSeconds: number }
  | { state: "issuing"; uid: string; issuanceId: string; retryAfterSeconds: 0 };

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

export function approveDeviceSession(session: DeviceSignInSession, uid: string, now: Date): DeviceSignInSession {
  if (expired(session, now) || session.state === "expired") throw new HttpError(410, "This device code has expired. Start sign-in again in WonderLang.");
  if (session.state === "consumed") throw new HttpError(410, "This device code has already been used. Start sign-in again in WonderLang.");
  if (session.approvedUid && session.approvedUid !== uid) throw new HttpError(409, "This device code was already approved for another WonderLang account.");
  if (session.state === "issuing") throw new HttpError(409, "This device sign-in is already being completed in WonderLang.");
  return {
    ...session,
    state: "approved",
    approvedUid: uid,
    approvedAt: session.approvedAt ?? now.toISOString()
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
    lease: { state: "issuing", uid: session.approvedUid, issuanceId, retryAfterSeconds: 0 }
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
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const rawCode = createUserCode();
      const userCode = formatDeviceUserCode(rawCode);
      const ref = this.db.collection("deviceSignInSessions").doc(deviceSessionDocumentId(rawCode));
      try {
        await ref.create({
          state: "pending",
          pollSecretHash: sha256(pollSecret),
          deviceLabel: safeDeviceLabel(input.deviceLabel),
          createdAt: input.now.toISOString(),
          expiresAt
        } satisfies DeviceSignInSession);
        const verificationUrl = new URL("/account/", input.publicAppOrigin);
        verificationUrl.searchParams.set("device_code", userCode);
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

  async approve(input: { uid: string; userCode: string; now: Date }): Promise<{ approved: true; userCode: string; deviceLabel: string }> {
    const userCode = formatDeviceUserCode(input.userCode);
    const ref = this.db.collection("deviceSignInSessions").doc(deviceSessionDocumentId(userCode));
    const result = await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new HttpError(404, "This device code was not found. Check the code shown by WonderLang.");
      const next = approveDeviceSession(snapshot.data() as DeviceSignInSession, input.uid, input.now);
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
      const customToken = await this.auth.createCustomToken(lease.uid, { wlDeviceSignIn: true });
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
